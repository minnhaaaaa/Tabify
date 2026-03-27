// Progress Bar Animation
const autoGroupBtn = document.getElementById('autoGroupBtn');
const progressFill = document.getElementById('progressFill');
const progressContainer = document.querySelector('.progress-container');
const btnLabel = document.getElementById('btnLabel');
const btnShortcut = document.getElementById('btnShortcut');
const statusDot = document.getElementById('statusDot');

autoGroupBtn.addEventListener('click', () => {
    let progress = 0;
    btnLabel.textContent = "Organizing...";
    btnShortcut.style.display = "none";
    progressContainer.style.display = "block";
    statusDot.className = "status-dot working";

    const interval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            setTimeout(() => {
                btnLabel.textContent = "Auto Group";
                btnShortcut.style.display = "block";
                progressContainer.style.display = "none";
                progressFill.style.width = "0%";
                statusDot.className = "status-dot idle";
            }, 600);
        }
        progressFill.style.width = progress + "%";
    }, 100);
});

// Toggle Logic
const dynamicToggle = document.getElementById('dynamicToggle');
const toggleStatus = document.getElementById('toggleStatus');
const toggleRow = document.getElementById('toggleRow');

dynamicToggle.addEventListener('change', function() {
    if (this.checked) {
        toggleStatus.textContent = "Live Active";
        toggleRow.classList.add('active-state');
    } else {
        toggleStatus.textContent = "Manual mode";
        toggleRow.classList.remove('active-state');
    }
});