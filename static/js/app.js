// Wait for the DOM to be fully loaded before running our script
document.addEventListener('DOMContentLoaded', () => {

    // --- Get Elements ---
    const hostName = document.body.dataset.host;
    const squeueContainer = document.getElementById('squeue-container');
    const sinfoContainer = document.getElementById('sinfo-container');
    const statusContainer = document.getElementById('status-container');
    const refreshButton = document.getElementById('refresh-btn');
    const filterInput = document.getElementById('filter-input');

    // --- Application State ---
    let fullJobList = [];
    let fullPartitionList = [];
    let lastUpdateTime = 0;
    let appState = {
        filterText: '',
        sortKey: 'job_id',
        sortDir: 'asc'
    };

    /**
     * Converts seconds into a D-HH:MM:SS format
     */
    function formatTime(totalSeconds) {
        let secondsNum = parseInt(totalSeconds, 10);
        if (isNaN(secondsNum) || secondsNum <= 0) {
            return '00:00:00';
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

    /**
     * Renders the Job Queue (squeue) table
     */
    function renderSqueue(jobs) {
        
        // Headers are needed in both cases (empty or full)
        const headers = [
            { key: 'job_id', name: 'Job ID' },
            { key: 'user_name', name: 'User' },
            { key: 'job_state', name: 'State' },
            { key: 'partition', name: 'Partition' },
            { key: 'name', name: 'Name' },
            { key: 'time', name: 'Time' }
        ];

        // --- FIX 1: Add class="job-table" for the CSS ---
        let tableHtml = '<table class="job-table"><thead><tr>';
        headers.forEach(h => {
            const sortDir = (h.key === appState.sortKey) ? `data-sort-dir="${appState.sortDir}"` : '';
            tableHtml += `<th data-sort-key="${h.key}" ${sortDir}>${h.name}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';

        // --- FIX 2: Updated empty table logic ---
        if (!jobs || jobs.length === 0) {
            tableHtml += '<tr>';
            // Add a single cell that spans all columns
            tableHtml += `<td colspan="${headers.length}" style="text-align: center; padding: 20px; font-style: italic;">`;
            // Show a different message if filtering
            tableHtml += (appState.filterText) ? 'No jobs match the filter.' : 'No jobs in the queue.';
            tableHtml += '</td></tr>';
        } else {
            // This is the existing loop to populate jobs
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
                tableHtml += '</tr>';
            }
        }
        // --- END FIX 2 ---

        tableHtml += '</tbody></table>';
        squeueContainer.innerHTML = tableHtml;
    }

    /**
     * Renders the Node Summary (sinfo) table
     */
    function renderSinfo(partitions) {
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
     * It applies filters and sorting before calling renderSqueue.
     */
    function renderApp() {
        const filterText = appState.filterText.toLowerCase();
        let filteredJobs = fullJobList;

        if (filterText) {
            filteredJobs = fullJobList.filter(job => {
                return (
                    job.user_name.toLowerCase().includes(filterText) ||
                    job.name.toLowerCase().includes(filterText) ||
                    job.partition.toLowerCase().includes(filterText) ||
                    String(job.job_id).includes(filterText)
                );
            });
        }

        const key = appState.sortKey;
        const dir = appState.sortDir === 'asc' ? 1 : -1;

        filteredJobs.sort((a, b) => {
            const valA = a[key];
            const valB = b[key];
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });

        // We pass the processed list to the render function
        renderSqueue(filteredJobs);
        
        // Node summary doesn't need filtering/sorting
        renderSinfo(fullPartitionList);
    }

    /**
     * Main function to fetch and orchestrate rendering
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

            lastUpdateTime = data.squeue.last_update.number;
            fullPartitionList = data.sinfo.sinfo;
            
            fullJobList = data.squeue.jobs.map(job => {
                const jobState = job.job_state[0] || 'UNKNOWN';
                let timeValue = 0;
                if (jobState === 'RUNNING') {
                    timeValue = lastUpdateTime - job.start_time.number;
                } else if (jobState === 'PENDING') {
                    timeValue = lastUpdateTime - job.submit_time.number;
                }
                return { ...job, time: timeValue }; 
            });
            
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
    
    fetchData();
    refreshButton.addEventListener('click', fetchData);

    filterInput.addEventListener('input', (e) => {
        appState.filterText = e.target.value;
        renderApp(); // Re-render with the new filter
    });

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