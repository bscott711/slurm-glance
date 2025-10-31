/**
 * ui.js
 * * Handles all DOM manipulation and rendering.
 * Reads from state, but does not write to it.
 */

import { formatTime } from './utils.js';

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
    html += '<table class="user-job-table"><thead><tr><th>User</th><th>Job Count</th></tr></thead><tbody>';
    
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
    
    // Sort partitions by name for consistent order
    const sortedPartitions = Object.keys(userJobCountsByPartition).sort();

    if (sortedPartitions.length === 0) {
        html += '<p style="font-style: italic; text-align: center;">No jobs to display by partition.</p>';
    }

    for (const partition of sortedPartitions) {
        const userList = userJobCountsByPartition[partition];
        html += `<h4>Partition: ${partition}</h4>`;
        html += '<table class="user-job-table"><thead><tr><th>User</th><th>Job Count</th></tr></thead><tbody>';
        
        const topUsers = userList.slice(0, 10);
        for (const item of topUsers) {
            html += `<tr><td>${item.user}</td><td>${item.count}</td></tr>`;
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
    const headers = ['Partition', 'State', 'Node Count'];
    let tableHtml = '<table><thead><tr>';
    headers.forEach(h => tableHtml += `<th>${h}</th>`);
    tableHtml += '</tr></thead><tbody>';
    for (const group of partitions) {
        const part_name = group.partition.name;
        // Use the new helper function to get the most important state
        const state = getPriorityNodeState(group.node.state);
        const count = group.nodes.total;
        
        if (count === 0) continue;
        
        let stateHtml = state;
        if (state.includes('IDLE')) stateHtml = `<span class="status-pending">${state}</span>`;
        if (state.includes('ALLOCATED')) stateHtml = `<span class="status-running">${state}</span>`;
        if (state.includes('MIXED')) stateHtml = `<span class="status-running">${state}</span>`;
        if (state.includes('DOWN')) stateHtml = `<span class="status-error">${state}</span>`;
        if (state.includes('DRAIN')) stateHtml = `<span class="status-error">${state}</span>`;
        if (state.includes('RESV')) stateHtml = `<span class="status-pending">${state}</span>`;
            
        tableHtml += `<tr><td>${part_name}</td><td>${stateHtml}</td><td>${count}</td></tr>`;
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
    
    // Define a priority order
    const priorities = ["DOWN", "DRAIN", "RESV", "MIXED", "ALLOCATED"];

    // Check for a higher-priority modifying state
    for (const priorityState of priorities) {
        if (stateArray.includes(priorityState)) {
            return priorityState;
        }
    }
    // Otherwise, return the base state
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
            
            tableHtml += `<td>${formatTime(job.time)}</td>`;
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