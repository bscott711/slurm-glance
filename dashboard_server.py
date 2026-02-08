import json
import re
from flask import Flask, jsonify, render_template
from fabric import Connection

app = Flask(__name__)


# --- GENERAL CLUSTER DATA ---
def get_cluster_data(host_name):
    try:
        with Connection(host=host_name) as c:
            sinfo = c.run("sinfo --json", hide=True).stdout
            squeue = c.run("squeue --json", hide=True).stdout
            return {
                "status": "success",
                "host": host_name,
                "sinfo": json.loads(sinfo),
                "squeue": json.loads(squeue),
            }
    except Exception as e:
        return {"status": "error", "host": host_name, "message": str(e)}


# --- PETAKIT SPECIFIC DATA ---
def get_petakit_data(host_name):
    try:
        with Connection(host=host_name) as c:
            # 1. Fetch ALL running jobs
            cmd = "squeue --states=RUNNING --json"
            res = c.run(cmd, hide=True, warn=True)

            if res.failed:
                return {"status": "idle", "message": "Failed to query squeue."}

            try:
                data = json.loads(res.stdout)
                jobs = data.get("jobs", [])
            except Exception:
                return {"status": "idle", "message": "Invalid JSON from squeue."}

            # 2. Find the Petakit job
            target_job = None
            for job in jobs:
                if "petakit" in job.get("name", "").lower():
                    target_job = job
                    break

            if not target_job:
                return {"status": "idle", "message": "No 'petakit' job found."}

            job_id = target_job.get("job_id")

            # 3. Determine Node
            node = target_job.get("batch_host")
            if not node:
                raw_node = target_job.get("nodes", "")
                node = raw_node.replace("[", "").replace("]", "")

            # 4. Get Real-Time CPU
            cpu_res = c.run(
                f"ssh {node} 'cat /proc/stat; sleep 0.5; echo \"---\"; cat /proc/stat'",
                hide=True,
                warn=True,
            )

            cpu = []
            if cpu_res.ok:
                parts = cpu_res.stdout.strip().split("---")
                if len(parts) >= 2:
                    cpu = parse_proc_stat(parts[0], parts[1])

            # 5. Smart Stats Extraction
            log_path = find_log_path(c, target_job, job_id)

            stats = {
                "phase": "Initializing",
                "count": 0,
                "total": 0,
                "percent": 0,
                "last_time": 0.0,
                "eta_seconds": 0,
                "current_file": "Waiting...",
            }

            if log_path:
                stats = extract_progress_stats(c, log_path)

            return {
                "status": "active",
                "job_id": job_id,
                "node": node,
                "cpu": cpu,
                "stats": stats,
            }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def find_log_path(c, job, job_id):
    """Helper to locate the log file."""
    paths = []
    slurm_out = job.get("standard_output")
    if slurm_out and slurm_out != "/dev/null":
        paths.append(slurm_out.replace("%j", str(job_id)))

    work_dir = job.get("current_working_directory", ".")
    paths.append(f"{work_dir}/logs/worker-{job_id}.log")
    paths.append(f"{work_dir}/worker-{job_id}.log")
    paths.append(f"~/logs/worker-{job_id}.log")

    for path in paths:
        if c.run(f"test -f {path}", warn=True, hide=True).ok:
            return path
    return None


def extract_progress_stats(c, log_path):
    stats = {
        "phase": "Processing",
        "count": 0,
        "total": 0,
        "percent": 0,
        "last_time": 0.0,
        "eta_seconds": 0,
        "current_file": "Parsing...",
    }

    # Initialize text_blob to None to prevent Pylance "unbound variable" errors
    text_blob = None

    # 1. Count Completed Images (grep is fast)
    count_res = c.run(f"grep -c 'Done! Elapsed time' {log_path}", hide=True, warn=True)
    if count_res.ok:
        try:
            stats["count"] = int(count_res.stdout.strip())
        except ValueError:
            pass

    # 2. Extract Total from Logs (Priority)
    grep_total = c.run(
        f"grep -E 'Task number|Raw Stacks' {log_path} | tail -n 5", hide=True, warn=True
    )

    if grep_total.ok:
        lines = grep_total.stdout.splitlines()
        for line in lines:
            # Check Deskew Format: "Task number : 80"
            m_task = re.search(r"Task number\s*[:=]\s*(\d+)", line)
            if m_task:
                stats["total"] = max(stats["total"], int(m_task.group(1)))

            # Check Crop Format: "Processing 40 Raw Stacks"
            m_crop = re.search(r"Processing\s+(\d+)\s+Raw Stacks", line)
            if m_crop:
                stats["total"] = max(stats["total"], int(m_crop.group(1)))

    # 3. Fallback: Directory Scan (If log total failed)
    if stats["total"] == 0:
        tail_res = c.run(f"tail -n 100 {log_path}", hide=True, warn=True)
        if tail_res.ok:
            text_blob = tail_res.stdout
            # Regex to find a file path: "frame /mmfs2/.../file.tif"
            path_match = re.search(r"frame\s+(/.+\.tif)", text_blob)
            if path_match:
                full_path = path_match.group(1)
                directory = full_path.rsplit("/", 1)[0]
                # Count .tif files
                find_cmd = f"find {directory} -maxdepth 1 -name '*.tif' | wc -l"
                total_res = c.run(find_cmd, hide=True, warn=True)
                if total_res.ok:
                    try:
                        stats["total"] = int(total_res.stdout.strip())
                    except ValueError:
                        pass

    # 4. Get Recent Context for Phase/File/Time
    # If text_blob wasn't populated in step 3, fetch it now
    if text_blob is None:
        tail_res = c.run(f"tail -n 100 {log_path}", hide=True, warn=True)
        text_blob = tail_res.stdout if tail_res.ok else ""

    lines = text_blob.splitlines()

    # Phase Detection
    if "Deskew" in text_blob:
        stats["phase"] = "Deskewing"
    elif "CROP_" in text_blob:
        stats["phase"] = "Cropping"

    # Time Extraction
    time_matches = re.findall(r"Elapsed time is ([\d\.]+) seconds", text_blob)
    if time_matches:
        stats["last_time"] = float(time_matches[-1])

    # File Detection
    for line in reversed(lines):
        if "Process" in line and "with function" in line:
            parts = line.split("Process ")[1].split(" with function")[0]
            stats["current_file"] = parts
            break
        if "Deskew, rotate" in line and "/" in line:
            filename = line.split("/")[-1].strip()
            stats["current_file"] = filename
            break

    # 5. Final Calculations
    if stats["total"] > 0:
        ratio = stats["count"] / stats["total"]
        if ratio > 1.0:
            ratio = 1.0  # Clamp to 100%
        stats["percent"] = round(ratio * 100, 1)

        remaining = stats["total"] - stats["count"]
        if remaining > 0 and stats["last_time"] > 0:
            stats["eta_seconds"] = int(remaining * stats["last_time"])

    return stats


def parse_proc_stat(stat1, stat2):
    """Calculates CPU utilization per core."""

    def get_vals(s):
        d = {}
        for line in s.splitlines():
            if line.startswith("cpu") and line.split()[0] != "cpu":
                parts = line.split()
                d[parts[0]] = [int(x) for x in parts[1:]]
        return d

    start, end = get_vals(stat1), get_vals(stat2)
    results = []

    try:
        sorted_keys = sorted(end.keys(), key=lambda x: int(x.replace("cpu", "")))
    except ValueError:
        sorted_keys = sorted(end.keys())

    for core in sorted_keys:
        if core not in start:
            continue
        v1, v2 = start[core], end[core]

        idle_delta = v2[3] - v1[3]
        total_delta = sum(v2) - sum(v1)

        usage = 0
        if total_delta > 0:
            usage = 100.0 * (1.0 - idle_delta / total_delta)

        results.append({"core": core.upper(), "usage": round(usage, 1)})
    return results


# --- ROUTES ---


@app.route("/")
def index():
    return render_template("home.html")


@app.route("/dashboard/<host_name>")
def dashboard(host_name):
    return render_template("index.html", hpc_host_name=host_name)


@app.route("/data/<host_name>")
def data(host_name):
    return jsonify(get_cluster_data(host_name))


@app.route("/petakit/<host_name>")
def petakit(host_name):
    return render_template("petakit.html", hpc_host_name=host_name)


@app.route("/api/petakit/<host_name>")
def petakit_api(host_name):
    return jsonify(get_petakit_data(host_name))


def main():
    print("Starting Slurpy on http://127.0.0.1:5001")
    app.run(debug=True, port=5001, host="127.0.0.1", use_reloader=False)


if __name__ == "__main__":
    main()
