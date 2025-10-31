// Wait for the DOM to be fully loaded before running our script
document.addEventListener('DOMContentLoaded', () => {

    // --- Get Elements ---
    const hostName = document.body.dataset.host;
    const squeueContainer = document.getElementById('squeue-container');
    const sinfoContainer = document.getElementById('sinfo-container');
    const statusContainer = document.getElementById('status-container');
    const refreshButton = document.getElementById('refresh-btn');
    const filterInput = document.getElementById('filter-input');
    const summaryContainer = document.getElementById('queue-summary-container'); // New

    // --- Application State ---
    // All data is stored here after being fetched
    let appState = {
        filterText: '',
        sortKey: 'job_id',
        sortDir: 'asc',
        
        fullJobList: [],
        fullPartitionList: [],
        
        // New summary data
        pendingJobCount: 0,
        uniqueUserCount: 0,
        userJobCounts: []
    };

    /**
     * Converts seconds into a D-HH:MM:SS format
     */
    function formatTime(totalSeconds) {
        let secondsNum = parseInt(totalSeconds, 10);
        if (isNaN(secondsNum) || secondsNum <= 0) {
            // Handle 0 or infinite time limits
            if (secondsNum === 0) return '00:00:00';
            return 'Infinite';
        }
        const days = Math.floor(secondsNum / 86400);
        secondsNum %= 86400;
        const hours = Math.floor(secondsNum / 3600);
        secondsNum %= 3600;
        const minutes = Math.floor(secondsNum / 60);
        secondsNum %= 60;
        const seconds = Math.floor(secondsNum);
        const pad = (num) => String(num).padStart(2, '0');
        let timeString = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        if (days > 0) {
            timeString = `${days}-${timeString}`;
        }
        return timeString;
    }

    // --- NEW Render Function for Summary Data ---
    function renderQueueSummary() {
        // 1. Render stat cards
        let html = '<div class="summary-grid">';
        html += `<div class="stat-card"><h3>Pending Jobs</h3><div class="stat-value">${appState.pendingJobCount}</div></div>`;
        html += `<div class="stat-card"><h3>Unique Users</h3><div class="stat-value">${appState.uniqueUserCount}</div></div>`;
        html += '</div>';

        // 2. Render user table
        html += '<h3>Jobs Per User (Top 10)</h3>';
        html += '<table class="user-job-table"><thead><tr><th>User</th><th>Job Count</th></tr></thead><tbody>';
        
        if (appState.userJobCounts.length === 0) {
             html += '<tr><td colspan="2" style="text-align: center; font-style: italic;">No users in queue.</td></tr>';
        } else {
            // Show only top 10
            const topUsers = appState.userJobCounts.slice(0, 10);
            for (const item of topUsers) {
                html += `<tr><td>${item.user}</td><td>${item.count}</td></tr>`;
            }
        }
        html += '</tbody></table>';
        
        summaryContainer.innerHTML = html;
    }

    /**
     * Renders the Job Queue (squeue) table
     */
    function renderSqueue(jobs) {
        
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
            const sortDir = (h.key === appState.sortKey) ? `data-sort-dir="${appState.sortDir}"` : '';
            tableHtml += `<th data-sort-key="${h.key}" ${sortDir}>${h.name}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';

        if (!jobs || jobs.length === 0) {
            tableHtml += '<tr>';
            tableHtml += `<td colspan="${headers.length}" style="text-align: center; padding: 20px; font-style: italic;">`;
            tableHtml += (appState.filterText) ? 'No jobs match the filter.' : 'No jobs in the queue.';
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
                
                // Add new time columns
                tableHtml += `<td>${formatTime(job.time)}</td>`;
                tableHtml += `<td>${formatTime(job.time_limit_sec)}</td>`;
                tableHtml += `<td>${(jobState === 'RUNNING') ? formatTime(job.time_left) : '-'}</td>`;
                
                tableHtml += '</tr>';
            }
        }

        tableHtml += '</tbody></table>';
        squeueContainer.innerHTML = tableHtml;
    }

    /**
     * Renders the Node Summary (sinfo) table
     */
    function renderSinfo() {
        const partitions = appState.fullPartitionList;
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
            const state = group.node.state[0];
            const count = group.nodes.total;
            if (count === 0) continue;
            let stateHtml = state;
            if (state.includes('IDLE')) stateHtml = `<span class="status-pending">${state}</span>`;
            if (state.includes('ALLOCATED')) stateHtml = `<span class="status-running">${state}</span>`;
            if (state.includes('MIXED')) stateHtml = `<span class="status-running">${state}</span>`;
            if (state.includes('DOWN')) stateHtml = `<span class="status-error">${state}</span>`;
            if (state.includes('DRAIN')) stateHtml = `<span class="status-error">${state}</span>`;
            tableHtml += `<tr><td>${part_name}</td><td>${stateHtml}</td><td>${count}</td></tr>`;
        }
        tableHtml += '</tbody></table>';
        sinfoContainer.innerHTML = tableHtml;
    }

    /**
     * This is the main render function.
     * It calls all individual render functions based on the appState.
     */
    function renderApp() {
        // --- 1. Apply Filtering to Job List ---
        const filterText = appState.filterText.toLowerCase();
        let filteredJobs = appState.fullJobList;

        if (filterText) {
            filteredJobs = appState.fullJobList.filter(job => {
                return (
                    job.user_name.toLowerCase().includes(filterText) ||
                    job.name.toLowerCase().includes(filterText) ||
                    job.partition.toLowerCase().includes(filterText) ||
                    String(job.job_id).includes(filterText)
                );
            });
        }

        // --- 2. Apply Sorting to Filtered List ---
        const key = appState.sortKey;
        const dir = appState.sortDir === 'asc' ? 1 : -1;

        filteredJobs.sort((a, b) => {
            const valA = a[key];
            const valB = b[key];
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });

        // --- 3. Call all render functions ---
        renderQueueSummary();
        renderSinfo();
        renderSqueue(filteredJobs);
    }

    /**
     * Main function to fetch data and update appState
     */
    async function fetchData() {
        refreshButton.disabled = true;
        try {
            statusContainer.textContent = `Fetching new data from ${hostName}...`;
            statusContainer.className = 'status-loading';
            
            const response = await fetch(`/data/${hostName}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            if (data.status === 'error') throw new Error(`Server error: ${data.message}`);

            const lastUpdateTime = data.squeue.last_update.number;
            
            // --- Update appState with all new data ---
            appState.fullPartitionList = data.sinfo.sinfo;
            
            appState.fullJobList = data.squeue.jobs.map(job => {
                const jobState = job.job_state[0] || 'UNKNOWN';
                let timeUsed = 0;
                if (jobState === 'RUNNING') {
                    timeUsed = lastUpdateTime - job.start_time.number;
                } else if (jobState === 'PENDING') {
                    timeUsed = lastUpdateTime - job.submit_time.number;
                }
                
                // time_limit.number is in MINUTES. 0 means infinite.
                const timeLimitInMin = (job.time_limit && job.time_limit.number) ? job.time_limit.number : -1;
                const timeLimitInSec = timeLimitInMin * 60;
                
                let timeLeft = 0;
                if (jobState === 'RUNNING' && timeLimitInMin > 0) {
                    timeLeft = timeLimitInSec - timeUsed;
                } else if (timeLimitInMin < 0) {
                    timeLeft = -1; // Flag for "Infinite"
                }

                return { 
                    ...job, 
                    time: timeUsed, 
                    time_limit_sec: timeLimitInSec, 
                    time_left: timeLeft 
                };
            });
            
            // --- Calculate Summary Data ---
            appState.pendingJobCount = appState.fullJobList.filter(j => j.job_state[0] === 'PENDING').length;
            appState.uniqueUserCount = new Set(appState.fullJobList.map(j => j.user_name)).size;

            const jobsPerUser = appState.fullJobList.reduce((acc, job) => {
                acc[job.user_name] = (acc[job.user_name] || 0) + 1;
                return acc;
            }, {});
            appState.userJobCounts = Object.entries(jobsPerUser).map(([user, count]) => ({ user, count }))
                                          .sort((a, b) => b.count - a.count); // Sort descending
            
            // --- Call the single render function ---
            renderApp();
            
            statusContainer.textContent = `Data last updated: ${new Date().toLocaleTimeString()}`;
            statusContainer.className = 'status-loading';

        } catch (error) {
            console.error('Fetch error:', error);
            statusContainer.textContent = `Error fetching data: ${error.message}`;
            statusContainer.className = 'status-error-box';
        } finally {
            refreshButton.disabled = false;
        }
    }

    // --- EVENT LISTENERS ---
    
    fetchData(); // Initial load
    refreshButton.addEventListener('click', fetchData); // Refresh button

    // Filter input (only calls render, not fetch)
    filterInput.addEventListener('input', (e) => {
        appState.filterText = e.target.value;
        renderApp();
    });

    // Sort click (only calls render, not fetch)
    squeueContainer.addEventListener('click', (e) => {
        const header = e.target.closest('th');
        if (header && header.dataset.sortKey) {
            const key = header.dataset.sortKey;
            
            if (appState.sortKey === key) {
                appState.sortDir = appState.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                appState.sortKey = key;
                appState.sortDir = 'asc';
            }
            
            renderApp(); // Re-render with new sorting
        }
    });

}); // End of DOMContentLoaded