/**
 * ui.js
 * * Handles all DOM manipulation and rendering.
 * Reads from state, but does not write to it.
 */

import { formatTime, getGresCount } from './utils.js';

// --- Get Elements ---
const squeueContainer = document.getElementById('squeue-container');
const sinfoContainer = document.getElementById('sinfo-container');
const statusContainer = document.getElementById('status-container');
const summaryContainer = document.getElementById('queue-summary-container');
const refreshButton = document.getElementById('refresh-btn');

// --- Renders all components ---
export function renderAll(state) {
    renderQueueSummary(state.getSummaryData());
    renderSinfo(state.getPartitionList());
    renderSqueue(state);
}

// --- Individual Component Renders ---

export function renderQueueSummary(summaryData) {
    const { runningJobCount, pendingJobCount, uniqueUserCount, userJobCounts, userJobCountsByPartition } = summaryData;

    // 1. Render stat cards (UPDATED grid-template-columns)
    let html = '<div class="summary-grid">'; // CSS rule handles the 3-col layout
    html += `<div class="stat-card"><h3>Running Jobs</h3><div class="stat-value">${runningJobCount}</div></div>`;
    html += `<div class="stat-card"><h3>Pending Jobs</h3><div class="stat-value">${pendingJobCount}</div></div>`;
    html += `<div class="stat-card"><h3>Unique Users</h3><div class="stat-value">${uniqueUserCount}</div></div>`;
    html += '</div>';

    // 2. Render user table (Total)
    html += '<h3>Jobs Per User (All Partitions)</h3>';
    // Added a class to distinguish the "total" table from the partition tables
    html += '<table class="user-job-table user-job-table-total"><thead><tr><th>User</th><th>Job Count</th></tr></thead><tbody>';
    
    if (userJobCounts.length === 0) {
         html += '<tr><td colspan="2" style="text-align: center; font-style: italic;">No users in queue.</td></tr>';
    } else {
        const topUsers = userJobCounts.slice(0, 10);
        for (const item of topUsers) {
            html += `<tr><td>${item.user}</td><td>${item.count}</td></tr>`;
        }
    }
    html += '</tbody></table>';

    // 3. NEW: Render per-partition user tables
    html += '<h3>Jobs Per User (By Partition)</h3>';
    
    const sortedPartitions = Object.keys(userJobCountsByPartition).sort();

    if (sortedPartitions.length === 0) {
        html += '<p style="font-style: italic; text-align: center;">No jobs to display by partition.</p>';
    }

    for (const partition of sortedPartitions) {
        const userList = userJobCountsByPartition[partition];
        html += `<h4>Partition: ${partition}</h4>`;
        // Added a new class for the 4-column layout
        html += '<table class="user-job-table user-job-table-partition"><thead><tr><th>User</th><th>Running</th><th>Pending</th><th>Total</th></tr></thead><tbody>';
        
        const topUsers = userList.slice(0, 10);
        for (const item of topUsers) {
            // New 4-column rows
            html += `<tr>
                        <td>${item.user}</td>
                        <td>${item.running}</td>
                        <td>${item.pending}</td>
                        <td>${item.total}</td>
                     </tr>`;
        }
        html += '</tbody></table>';
    }
    
    summaryContainer.innerHTML = html;
}

export function renderSinfo(partitions) {
    if (!partitions || partitions.length === 0) {
        sinfoContainer.innerHTML = "<p>No node information available.</p>";
        return;
    }
    
    // UPDATED HEADERS for Per-Node View
    const headers = ['Node', 'Partition', 'State', 'CPUs (Free/Total)', 'Memory (Free/Total GB)', 'GPUs (Free/Total)'];
    let tableHtml = '<table class="sinfo-table"><thead><tr>';
    headers.forEach(h => tableHtml += `<th>${h}</th>`);
    tableHtml += '</tr></thead><tbody>';
    
    // Loop through each partition/state group
    for (const group of partitions) {
        
        const part_name = group.partition.name;
        const group_state = getPriorityNodeState(group.node.state);
        const group_count = group.nodes.total;

        if (group_count === 0) continue;

        // --- Calculate Per-Node Resources ---
        
        // CPU Calculation
        const total_cpus = group.cpus.total;
        const per_node_cpus = Math.round(total_cpus / group_count);
        let allocated_cpus_per_node = 0;
        
        // Memory Calculation
        const total_mem_mb = group.memory.minimum;
        const allocated_mem_mb = group.memory.allocated;
        
        const per_node_mem_total_gb = Math.round((total_mem_mb / group_count) / 1024);
        let per_node_mem_allocated_gb = 0;
        
        // GPU Calculation (UPDATED)
        const gresCounts = getGresCount(group.gres.total, group.gres.used);
        const per_node_gpu_total = Math.round(gresCounts.total / group_count);
        let per_node_gpu_allocated = 0;
        
        // Only calculate allocated/free if the group state indicates usage
        if (group_state.includes('ALLOCATED') || group_state.includes('MIXED')) {
            const total_allocated_cpus = group.cpus.allocated;
            allocated_cpus_per_node = Math.round(total_allocated_cpus / group_count);

            const total_allocated_mem = group.memory.allocated;
            per_node_mem_allocated_gb = Math.round((total_allocated_mem / group_count) / 1024);
            
            const total_allocated_gpu = gresCounts.used;
            per_node_gpu_allocated = Math.round(total_allocated_gpu / group_count);
        }
        
        // --- Calculate FREE values ---
        const per_node_cpus_free = per_node_cpus - allocated_cpus_per_node;
        const per_node_mem_free_gb = per_node_mem_total_gb - per_node_mem_allocated_gb;
        const per_node_gpu_free = per_node_gpu_total - per_node_gpu_allocated;
        
        // --- Create a row for EACH node ---
        const nodelist_array = group.nodes.nodes;
        
        for (const node of nodelist_array) {
            
            let stateHtml = group_state;
            if (group_state.includes('IDLE')) stateHtml = `<span class="status-pending">${group_state}</span>`;
            if (group_state.includes('ALLOCATED')) stateHtml = `<span class="status-running">${group_state}</span>`;
            if (group_state.includes('MIXED')) stateHtml = `<span class="status-running">${group_state}</span>`;
            if (group_state.includes('DOWN')) stateHtml = `<span class="status-error">${group_state}</span>`;
            if (group_state.includes('DRAIN')) stateHtml = `<span class="status-error">${group_state}</span>`;
            if (group_state.includes('RESERVED')) stateHtml = `<span class="status-pending">${group_state}</span>`;

            tableHtml += `<tr>
                <td>${node}</td>
                <td>${part_name}</td>
                <td>${stateHtml}</td>
                <td>${per_node_cpus_free}/${per_node_cpus}</td>
                <td>${per_node_mem_free_gb}/${per_node_mem_total_gb} GB</td>
                <td>${per_node_gpu_free}/${per_node_gpu_total}</td>
            </tr>`;
        }
    }
    tableHtml += '</tbody></table>';
    sinfoContainer.innerHTML = tableHtml;
}

/**
 * Finds the most "important" state from a state array.
 * e.g., ["IDLE", "DRAIN"] should be reported as "DRAIN".
 */
function getPriorityNodeState(stateArray) {
    const state = (stateArray[0] || "UNKNOWN").toUpperCase();
    const priorities = ["DOWN", "DRAIN", "RESERVED", "MIXED", "ALLOCATED"];
    for (const priorityState of priorities) {
        if (stateArray.includes(priorityState)) {
            return priorityState;
        }
    }
    return state;
}

export function renderSqueue(state) {
    const { sortKey, sortDir, filterText } = state.getState();
    const jobs = state.getFilteredAndSortedJobs();
    
    const headers = [
        { key: 'job_id', name: 'Job ID' },
        { key: 'user_name', name: 'User' },
        { key: 'job_state', name: 'State' },
        { key: 'partition', name: 'Partition' },
        { key: 'name', name: 'Name' },
        { key: 'time', name: 'Time Used' },
        { key: 'time_limit_sec', name: 'Time Limit' },
        { key: 'time_left', name: 'Time Left' }
    ];

    let tableHtml = '<table class="job-table"><thead><tr>';
    headers.forEach(h => {
        const sortDirClass = (h.key === sortKey) ? `data-sort-dir="${sortDir}"` : '';
        tableHtml += `<th data-sort-key="${h.key}" ${sortDirClass}>${h.name}</th>`;
    });
    tableHtml += '</tr></thead><tbody>';

    if (!jobs || jobs.length === 0) {
        tableHtml += '<tr>';
        tableHtml += `<td colspan="${headers.length}" style="text-align: center; padding: 20px; font-style: italic;">`;
        tableHtml += (filterText) ? 'No jobs match the filter.' : 'No jobs in the queue.';
        tableHtml += '</td></tr>';
    } else {
        for (const job of jobs) {
            tableHtml += '<tr>';
            const jobState = job.job_state[0] || 'UNKNOWN';
            
            tableHtml += `<td>${job.job_id}</td>`;
            tableHtml += `<td>${job.user_name}</td>`;
            
            if (jobState === 'RUNNING') tableHtml += `<td><span class="status-running">${jobState}</span></td>`;
            else if (jobState === 'PENDING') tableHtml += `<td><span class="status-pending">${jobState}</span></td>`;
            else tableHtml += `<td>${jobState}</td>`;
            
            tableHtml += `<td>${job.partition}</td>`;
            tableHtml += `<td>${job.name}</td>`;
            
            // --- THIS IS THE CHANGE ---
            let timeHtml = formatTime(job.time);
            if (jobState === 'PENDING') {
                // Wrap "Time in Queue" in the pending status span
                timeHtml = `<span class="status-pending">${timeHtml}</span>`;
            }
            tableHtml += `<td>${timeHtml}</td>`;
            // --- END CHANGE ---

            tableHtml += `<td>${formatTime(job.time_limit_sec)}</td>`;
            tableHtml += `<td>${(jobState === 'RUNNING') ? formatTime(job.time_left) : '-'}</td>`;
            
            tableHtml += '</tr>';
        }
    }

    tableHtml += '</tbody></table>';
    squeueContainer.innerHTML = tableHtml;
}

// --- UI State Changers ---
export function updateStatus(message, isError = false) {
    statusContainer.textContent = message;
    statusContainer.className = isError ? 'status-error-box' : 'status-loading';
}

export function setRefreshButtonEnabled(isEnabled) {
    refreshButton.disabled = !isEnabled;
}