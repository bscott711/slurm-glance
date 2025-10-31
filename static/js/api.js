/**
 * api.js
 * * Handles all communication with the backend server.
 */

export async function fetchClusterData(hostName) {
    const response = await fetch(`/data/${hostName}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.status === 'error') {
        throw new Error(`Server error: ${data.message}`);
    }
    
    return data;
}