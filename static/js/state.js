/**
 * state.js
 * * Manages the application's state. This is the single source of truth.
 * No DOM manipulation here.
 */

// Private state
let _state = {
    filterText: '',
    sortKey: 'job_id',
    sortDir: 'asc',
    
    fullJobList: [],
    fullPartitionList: [],
    
    // Summary data
    runningJobCount: 0, // NEW
    pendingJobCount: 0,
    uniqueUserCount: 0,
    userJobCounts: [], // This is now the "Total" list
    userJobCountsByPartition: {} // NEW
};

/**
 * Updates the state with new data from the API.
 * This is where all data processing and calculation happens.
 */
export function setData(data) {
    // Check if squeue data is present
    const lastUpdateTime = data.squeue.last_update ? data.squeue.last_update.number : Math.floor(Date.now() / 1000);
    const jobs = data.squeue.jobs || [];
    
    _state.fullPartitionList = data.sinfo.sinfo || [];
    
    // --- Pre-process jobs ---
    _state.fullJobList = jobs.map(job => {
        const jobState = job.job_state[0] || 'UNKNOWN';
        let timeUsed = 0;
        if (jobState === 'RUNNING') {
            timeUsed = lastUpdateTime - job.start_time.number;
        } else if (jobState === 'PENDING') {
            timeUsed = lastUpdateTime - job.submit_time.number;
        }
        
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
    _state.runningJobCount = _state.fullJobList.filter(j => j.job_state[0] === 'RUNNING').length; // NEW
    _state.pendingJobCount = _state.fullJobList.filter(j => j.job_state[0] === 'PENDING').length;
    _state.uniqueUserCount = new Set(_state.fullJobList.map(j => j.user_name)).size;

    // --- Calculate Top Users (Total) ---
    const jobsPerUser = _state.fullJobList.reduce((acc, job) => {
        acc[job.user_name] = (acc[job.user_name] || 0) + 1;
        return acc;
    }, {});
    _state.userJobCounts = Object.entries(jobsPerUser).map(([user, count]) => ({ user, count }))
                                  .sort((a, b) => b.count - a.count); // Sort descending

    // --- NEW: Calculate Top Users (By Partition) ---
    const jobsByPartition = _state.fullJobList.reduce((acc, job) => {
        const part = job.partition || 'unknown';
        if (!acc[part]) {
            acc[part] = {};
        }
        acc[part][job.user_name] = (acc[part][job.user_name] || 0) + 1;
        return acc;
    }, {});
    
    _state.userJobCountsByPartition = {};
    for (const partition in jobsByPartition) {
        _state.userJobCountsByPartition[partition] = Object.entries(jobsByPartition[partition])
            .map(([user, count]) => ({ user, count }))
            .sort((a, b) => b.count - a.count); // Sort descending
    }
}

// --- Getters ---
export const getState = () => _state;
export const getPartitionList = () => _state.fullPartitionList;
export const getSummaryData = () => ({
    runningJobCount: _state.runningJobCount, // NEW
    pendingJobCount: _state.pendingJobCount,
    uniqueUserCount: _state.uniqueUserCount,
    userJobCounts: _state.userJobCounts,
    userJobCountsByPartition: _state.userJobCountsByPartition // NEW
});

/**
 * Applies the current filter and sort to the job list
 */
export function getFilteredAndSortedJobs() {
    const filterText = _state.filterText.toLowerCase();
    let filteredJobs = _state.fullJobList;

    if (filterText) {
        filteredJobs = _state.fullJobList.filter(job => {
            return (
                job.user_name.toLowerCase().includes(filterText) ||
                job.name.toLowerCase().includes(filterText) ||
                job.partition.toLowerCase().includes(filterText) ||
                String(job.job_id).includes(filterText)
            );
        });
    }

    const key = _state.sortKey;
    const dir = _state.sortDir === 'asc' ? 1 : -1;

    filteredJobs.sort((a, b) => {
        const valA = a[key];
        const valB = b[key];
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });
    
    return filteredJobs;
}

// --- Setters for UI state ---
export function setFilter(text) {
    _state.filterText = text;
}

export function setSort(key) {
    if (_state.sortKey === key) {
        _state.sortDir = _state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        _state.sortKey = key;
        _state.sortDir = 'asc';
    }
}