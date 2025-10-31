/**
 * main.js
 * * The main entry point for the application.
 * Initializes the app, wires up event listeners, and controls the flow.
 */

// Import modules
import * as api from './api.js';
import * as state from './state.js';
import * as ui from './ui.js';

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {

    // --- Get Elements ---
    const hostName = document.body.dataset.host;
    const refreshButton = document.getElementById('refresh-btn');
    const filterInput = document.getElementById('filter-input');
    const squeueContainer = document.getElementById('squeue-container');

    /**
     * Main function to fetch data, update state, and render everything.
     */
    async function handleFetch() {
        ui.setRefreshButtonEnabled(false);
        ui.updateStatus(`Fetching new data from ${hostName}...`);
        
        try {
            const data = await api.fetchClusterData(hostName);
            
            // Update the state with the new data
            state.setData(data);
            
            // Render the entire app based on the new state
            renderApp();
            
            ui.updateStatus(`Data last updated: ${new Date().toLocaleTimeString()}`);

        } catch (error) {
            console.error('Fetch error:', error);
            ui.updateStatus(`Error fetching data: ${error.message}`, true);
        } finally {
            ui.setRefreshButtonEnabled(true);
        }
    }

    /**
     * Renders just the components that change (the tables)
     * based on the current state.
     */
    function renderApp() {
        // Pass the state module itself to the render functions
        ui.renderSqueue(state);
        ui.renderSinfo(state.getPartitionList());
        ui.renderQueueSummary(state.getSummaryData());
    }

    // --- EVENT LISTENERS ---
    
    // Initial data load
    handleFetch();
    
    // Refresh button click
    refreshButton.addEventListener('click', handleFetch);

    // Filter input
    filterInput.addEventListener('input', (e) => {
        state.setFilter(e.target.value);
        // Only re-render Squeue, not the other components
        ui.renderSqueue(state);
    });

    // Sort click (using event delegation)
    squeueContainer.addEventListener('click', (e) => {
        const header = e.target.closest('th');
        if (header && header.dataset.sortKey) {
            state.setSort(header.dataset.sortKey);
            // Only re-render Squeue
            ui.renderSqueue(state);
        }
    });

});