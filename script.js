/**
 * AUDIO ENGINE
 * Generates procedural binaural beats and pentatonic chimes
 */
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.droneGain = null;
        this.scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25];
    }

    init() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.6;
        this.masterGain.connect(this.ctx.destination);

        this.droneOsc1 = this.ctx.createOscillator();
        this.droneOsc2 = this.ctx.createOscillator();
        this.droneGain = this.ctx.createGain();

        this.droneOsc1.type = 'sine';
        this.droneOsc2.type = 'sine';
        this.droneOsc1.frequency.value = 136.1;
        this.droneOsc2.frequency.value = 142.1; // 6Hz diff (Theta waves)

        const panLeft = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
        const panRight = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
        if (panLeft.pan) { panLeft.pan.value = -1; panRight.pan.value = 1; }

        this.droneOsc1.connect(panLeft);
        this.droneOsc2.connect(panRight);
        panLeft.connect(this.droneGain);
        panRight.connect(this.droneGain);
        this.droneGain.connect(this.masterGain);

        this.droneGain.gain.value = 0;
        this.droneOsc1.start();
        this.droneOsc2.start();
        
        this.droneGain.gain.setTargetAtTime(0.15, this.ctx.currentTime, 2);
    }

    playHitSound(flowMultiplier) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        const noteIndex = Math.min(Math.floor(flowMultiplier * 2), this.scale.length - 1);
        osc.frequency.value = this.scale[noteIndex];
        osc.type = 'sine';

        osc.connect(gain);
        gain.connect(this.masterGain);

        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.8);

        osc.start();
        osc.stop(this.ctx.currentTime + 1);
    }

    playMissSound() {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.4);
        
        osc.connect(gain);
        gain.connect(this.masterGain);

        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.5);
        
        // Fade drone out on miss
        this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
    }

    updateDrone(flowMultiplier) {
        if (!this.ctx) return;
        const targetVolume = 0.15 + (flowMultiplier * 0.1);
        this.droneGain.gain.setTargetAtTime(targetVolume, this.ctx.currentTime, 0.5);
        this.droneOsc2.frequency.setTargetAtTime(136.1 + 6 + (flowMultiplier * 2), this.ctx.currentTime, 1);
    }
}

/**
 * GAME ENGINE & STATE
 */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

let width, height, centerX, centerY;
let isPlaying = false;
let animationId;

// Theme Colors
const COLORS = {
    bg: '#050505',
    center: '#06b6d4', 
    node: '#a855f7',   
    hit: '#22d3ee',
    miss: '#ef4444'    
};

// Strict Tracking Stats
let points = 0;
let flowMultiplier = 0;     // 0.0 to 1.0 scale
let gameStartTime = 0;
let flowStartTime = null;   // Timestamp when flow state is entered
const FLOW_THRESHOLD = 0.8; // At 80% multiplier, we consider the user "In Flow"

// Dynamic Difficulty Adjustment (DDA) Variables
let baseSpeed = 0;
let currentSpeed = 0;
let spawnInterval = 0;
let lastSpawnTime = 0;
let hitZoneRadius = 0;

// Game Entities Arrays
let nodes = [];
let particles = [];
let visualRings = [];

const audio = new AudioEngine();

// 0: Up, 1: Right, 2: Down, 3: Left
const DIRS = [
    { x: 0, y: -1 }, 
    { x: 1, y: 0 },  
    { x: 0, y: 1 },  
    { x: -1, y: 0 }  
];

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    centerX = width / 2;
    centerY = height / 2;
    
    hitZoneRadius = Math.min(width, height) * 0.1;
    baseSpeed = Math.min(width, height) * 0.0035;
    if(isPlaying) currentSpeed = baseSpeed + (flowMultiplier * baseSpeed * 1.5);
}
window.addEventListener('resize', resize);

class Node {
    constructor() {
        this.dirIndex = Math.floor(Math.random() * 4);
        this.dir = DIRS[this.dirIndex];
        
        const spawnDist = Math.max(width, height) * 0.8;
        this.x = centerX + (this.dir.x * spawnDist);
        this.y = centerY + (this.dir.y * spawnDist);
        
        this.radius = hitZoneRadius * 0.3;
        this.active = true;
        
        this.targetX = centerX;
        this.targetY = centerY;
    }

    update(speed) {
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > speed) {
            this.x += (dx / dist) * speed;
            this.y += (dy / dist) * speed;
        } else {
            this.x = this.targetX;
            this.y = this.targetY;
        }

        // If it touches the dead center without being hit = Game Over
        if (dist < hitZoneRadius * 0.2 && this.active) {
            this.active = false;
            triggerGameOver();
        }
    }

    draw(ctx) {
        if (!this.active) return;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.node;
        ctx.shadowBlur = 15;
        ctx.shadowColor = COLORS.node;
        ctx.fill();
        ctx.shadowBlur = 0; 
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 5 + 3;
        this.vx = Math.cos(angle) * velocity;
        this.vy = Math.sin(angle) * velocity;
        this.life = 1.0;
        this.decay = Math.random() * 0.02 + 0.015;
        this.size = Math.random() * 5 + 2;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

class VisualRing {
    constructor() {
        this.radius = hitZoneRadius;
        this.life = 1.0;
    }
    update() {
        this.radius += 3;
        this.life -= 0.04;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.strokeStyle = COLORS.hit;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, this.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }
}

// --- Gameplay Mechanics ---

function handleInput(dirIndex) {
    if (!isPlaying) return;

    let hit = false;
    let targetNode = null;
    let minDist = Infinity;

    // Find the closest active node in the pressed direction
    for (let node of nodes) {
        if (node.active && node.dirIndex === dirIndex) {
            const dist = Math.sqrt(Math.pow(node.x - centerX, 2) + Math.pow(node.y - centerY, 2));
            if (dist < minDist) {
                minDist = dist;
                targetNode = node;
            }
        }
    }

    const tolerance = hitZoneRadius * 1.5; 
    
    if (targetNode && minDist <= tolerance) {
        // Perfect hit
        targetNode.active = false;
        handleHit(targetNode.x, targetNode.y);
    } else {
        // Tapped but missed the timing or pressed wrong direction
        triggerGameOver();
    }
}

function handleHit(x, y) {
    points++;
    document.getElementById('hudPoints').innerText = points;

    // Increase difficulty metrics
    flowMultiplier = Math.min(1.0, flowMultiplier + 0.04);
    currentSpeed = baseSpeed + (flowMultiplier * baseSpeed * 1.5);
    spawnInterval = Math.max(500, 2200 - (flowMultiplier * 1700)); 

    // Track Flow State Entry Time
    if (flowMultiplier >= FLOW_THRESHOLD && flowStartTime === null) {
        flowStartTime = performance.now();
        document.getElementById('hudState').innerText = "FLOW STATE ACHIEVED";
        document.getElementById('hudState').classList.replace('text-purple-400', 'text-green-400');
        document.getElementById('hudState').classList.add('font-bold', 'animate-pulse');
    }
    
    // Trigger Visuals and Audio
    for (let i = 0; i < 15; i++) particles.push(new Particle(x, y, COLORS.hit));
    visualRings.push(new VisualRing());
    audio.playHitSound(flowMultiplier);
    audio.updateDrone(flowMultiplier);
    
    // Brief screen flash on hit
    ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
    ctx.fillRect(0, 0, width, height);
}

function formatTime(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function triggerGameOver() {
    if (!isPlaying) return;
    isPlaying = false;
    
    let endTime = performance.now();
    let totalFocusMs = endTime - gameStartTime;
    
    // Stats Calculations
    let timeToFlowStr = "Did not reach flow";
    let timeInFlowStr = "0s";
    
    if (flowStartTime !== null) {
        let timeToFlowMs = flowStartTime - gameStartTime;
        let timeInFlowMs = endTime - flowStartTime;
        timeToFlowStr = formatTime(timeToFlowMs);
        timeInFlowStr = formatTime(timeInFlowMs);
    }

    // Populate End Screen Stats
    document.getElementById('statPoints').innerText = points;
    document.getElementById('statTotalTime').innerText = formatTime(totalFocusMs);
    document.getElementById('statEntryTime').innerText = timeToFlowStr;
    document.getElementById('statFlowDuration').innerText = timeInFlowStr;

    // Failure Visuals and Audio
    for (let i = 0; i < 30; i++) particles.push(new Particle(centerX, centerY, COLORS.miss));
    audio.playMissSound();

    ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
    ctx.fillRect(0, 0, width, height);
    
    canvas.style.transform = `translate(${Math.random()*15-7.5}px, ${Math.random()*15-7.5}px)`;
    setTimeout(() => { canvas.style.transform = 'translate(0,0)'; }, 50);

    // Hide HUD, Show Game Over Screen
    document.getElementById('hud').classList.remove('opacity-100');
    document.getElementById('hud').classList.add('opacity-0');
    
    setTimeout(() => {
        cancelAnimationFrame(animationId);
        document.getElementById('gameOverLayer').classList.remove('hidden');
        document.getElementById('gameOverLayer').classList.add('flex');
    }, 500);
}

function startGame() {
    document.getElementById('uiLayer').classList.add('opacity-0', 'pointer-events-none');
    document.getElementById('gameOverLayer').classList.add('hidden');
    document.getElementById('gameOverLayer').classList.remove('flex');
    
    // Show HUD
    const hud = document.getElementById('hud');
    hud.classList.remove('hidden');
    setTimeout(() => { hud.classList.remove('opacity-0'); hud.classList.add('opacity-100'); }, 100);

    // Init audio on first user click
    if (!audio.ctx) audio.init();
    
    resize(); 
    
    // Reset Stats & State
    nodes = [];
    particles = [];
    visualRings = [];
    points = 0;
    flowMultiplier = 0;
    spawnInterval = 2200;
    currentSpeed = baseSpeed;
    flowStartTime = null;
    gameStartTime = performance.now();
    lastSpawnTime = gameStartTime;
    
    // Reset HUD strings
    document.getElementById('hudPoints').innerText = "0";
    document.getElementById('hudState').innerText = "Warming Up";
    document.getElementById('hudState').className = "text-purple-400";
    
    isPlaying = true;
    animationId = requestAnimationFrame(gameLoop);

    // Ensure drone volume is correct on restart
    if(audio.droneGain) {
        audio.droneGain.gain.setTargetAtTime(0.15, audio.ctx.currentTime, 1);
    }
}

function gameLoop(timestamp) {
    if (!isPlaying) {
        // If game is over, keep rendering particles until they fade out
        ctx.fillStyle = `rgba(5, 5, 5, 1)`; 
        ctx.fillRect(0, 0, width, height);
        for (let i = particles.length - 1; i >= 0; i--) {
            let p = particles[i];
            p.update();
            p.draw(ctx);
            if (p.life <= 0) particles.splice(i, 1);
        }
        if (particles.length > 0) animationId = requestAnimationFrame(gameLoop);
        return;
    }

    // Motion Blur background (low alpha fill creates trails)
    ctx.fillStyle = `rgba(5, 5, 5, 0.35)`; 
    ctx.fillRect(0, 0, width, height);

    // Spawn new nodes
    if (timestamp - lastSpawnTime > spawnInterval) {
        nodes.push(new Node());
        lastSpawnTime = timestamp;
    }

    // Draw pulsating center Aura
    const pulse = Math.sin(timestamp * 0.003) * (hitZoneRadius * 0.1 * flowMultiplier);
    const currentAuraRadius = hitZoneRadius + pulse;
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, currentAuraRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(6, 182, 212, ${0.3 + (flowMultiplier * 0.5)})`;
    ctx.lineWidth = 2 + (flowMultiplier * 3);
    ctx.shadowBlur = 20 * flowMultiplier;
    ctx.shadowColor = COLORS.center;
    ctx.stroke();
    ctx.shadowBlur = 0;
    
    // Central anchor point
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.center;
    ctx.fill();

    // Update & draw visual hit rings
    for (let i = visualRings.length - 1; i >= 0; i--) {
        let ring = visualRings[i];
        ring.update();
        ring.draw(ctx);
        if (ring.life <= 0) visualRings.splice(i, 1);
    }

    // Update & draw incoming nodes
    for (let i = nodes.length - 1; i >= 0; i--) {
        let node = nodes[i];
        node.update(currentSpeed);
        node.draw(ctx);
        // Garbage cleanup for nodes that hit the exact center
        if (!node.active && node.x === centerX && node.y === centerY) {
            nodes.splice(i, 1);
        }
    }

    // Draw explosion particles (Neon blending mode)
    ctx.globalCompositeOperation = 'lighter'; 
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.update();
        p.draw(ctx);
        if (p.life <= 0) particles.splice(i, 1);
    }
    ctx.globalCompositeOperation = 'source-over'; 

    animationId = requestAnimationFrame(gameLoop);
}

// --- Input Handling ---

// Desktop Keyboard Controls
window.addEventListener('keydown', (e) => {
    if (!isPlaying) return;
    switch(e.key) {
        case 'ArrowUp': case 'w': case 'W': handleInput(0); break;
        case 'ArrowRight': case 'd': case 'D': handleInput(1); break;
        case 'ArrowDown': case 's': case 'S': handleInput(2); break;
        case 'ArrowLeft': case 'a': case 'A': handleInput(3); break;
    }
});

// Mobile Touch & Swipe Controls
let touchStartX = 0, touchStartY = 0;
window.addEventListener('touchstart', (e) => {
    if (!isPlaying) return;
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, {passive: false});

window.addEventListener('touchend', (e) => {
    if (!isPlaying) return;
    let touchEndX = e.changedTouches[0].screenX;
    let touchEndY = e.changedTouches[0].screenY;
    
    const dx = touchEndX - touchStartX;
    const dy = touchEndY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) > 30) {
        if (absDx > absDy) {
            if (dx > 0) handleInput(1); else handleInput(3);
        } else {
            if (dy > 0) handleInput(2); else handleInput(0);
        }
    } else {
        // Simple tap without swiping = miss
        triggerGameOver(); 
    }
}, {passive: false});

// Strict Focus Law: Tabbing out instantly kills your run
window.addEventListener('blur', () => {
    if (isPlaying) triggerGameOver();
});

// Connect buttons to logic
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);

// Initial canvas setup
resize();
ctx.fillStyle = COLORS.bg;
ctx.fillRect(0, 0, canvas.width, canvas.height);
