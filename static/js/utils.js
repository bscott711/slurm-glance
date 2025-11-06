/**
 * utils.js
 * * Helper functions that don't depend on state or the DOM.
 */

export function formatTime(totalSeconds) {
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

export function getGresCount(gresTotal, resource = 'gpu') {
    if (!gresTotal) return 0;
    const parts = gresTotal.split(',');
    for (const part of parts) {
        if (part.includes(resource)) {
            // Part will be like 'gpu:2'
            const count = part.split(':')[1];
            return parseInt(count, 10) || 0;
        }
    }
    return 0;
}