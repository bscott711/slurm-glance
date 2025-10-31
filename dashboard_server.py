import json
from flask import Flask, jsonify, render_template
from fabric import Connection

app = Flask(__name__)

def get_cluster_data(host_name):
    """
    Connects to the specified HPC host via SSH, fetches data,
    and relies on the ~/.ssh/config for connection parameters.
    """
    print(f"Connecting to host alias: {host_name} (using ~/.ssh/config)...")
    try:
        with Connection(host=host_name) as c:
            
            print(f"Connected to {host_name}. Fetching sinfo...")
            sinfo_result = c.run('sinfo --json', hide=True)
            
            print("Fetching squeue for all users...")
            squeue_result = c.run('squeue --json', hide=True)

            # Parse and return the data
            sinfo_data = json.loads(sinfo_result.stdout)
            squeue_data = json.loads(squeue_result.stdout)

            print(f"Successfully fetched data from {host_name}.")
            return {
                "status": "success",
                "host": host_name,
                "sinfo": sinfo_data,
                "squeue": squeue_data
            }

    except Exception as e:
        print(f"Error connecting to {host_name}: {e}")
        return {
            "status": "error",
            "host": host_name,
            "message": str(e)
        }

@app.route('/')
def index():
    """Serves the main host-selection page."""
    return render_template('home.html')

@app.route('/dashboard/<host_name>')
def dashboard_page(host_name):
    """Serves the dashboard page for a specific host."""
    return render_template('index.html', hpc_host_name=host_name)


@app.route('/data/<host_name>')
def data_endpoint(host_name):
    """Provides the raw cluster data as JSON for a specific host."""
    data = get_cluster_data(host_name)
    return jsonify(data)

if __name__ == '__main__':
    print("Starting local dashboard server at http://127.0.0.1:5001")
    app.run(debug=True, port=5001, host='127.0.0.1')