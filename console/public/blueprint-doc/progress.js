/* Mark 1 build progress — the single source of truth for the blueprint status layer.
 *
 * HOW TO UPDATE: edit this file at the end of any working session (or ask a
 * Claude session to "update the blueprint progress"). Commit it with the work —
 * `git log docs/architecture/progress.js` becomes the project history.
 *
 * stage ladder: spec -> sim -> bench -> field
 *   spec  = designed/spec'd only          sim   = proven in Gazebo simulation
 *   bench = proven on real hardware desk  field = proven outdoors on the rover
 *
 * Every done milestone should carry a `proof` (commit, doc, test, measurement).
 * `submodules` = the parts inside each module, each with its own stage — this
 * drives the per-part blocks + colours in the 3D architecture view.
 * `links` tracks proven module boundaries; keys must match the blueprint's
 * link pairs (cc-tel, tel-core, core-loco, core-bay, core-lab).
 * Plain <script> file (not JSON) so the page also works from file://.
 */
window.MARK1_PROGRESS = {
  updated: '2026-07-09',

  components: {
    core: {
      stage: 'bench',
      repos: 'friday-labs-os · friday-core-os · friday-rover-brain',
      next: 'Deploy the rover brain on Legion (MiniMax-M3) → first live mission turn',
      submodules: [
        { n: 'module-registry',            stage: 'bench' },
        { n: 'mosquitto-internal',         stage: 'bench' },
        { n: 'micro-ROS agent',            stage: 'bench' },
        { n: 'os-control agent',           stage: 'bench' },
        { n: 'SOUL.md context store',      stage: 'bench' },
        { n: 'operating-mode store',       stage: 'bench' },
        { n: 'command validator / router', stage: 'sim'   },
        { n: 'safety-supervisor',          stage: 'sim'   },
        { n: 'fault-manager',              stage: 'sim'   },
        { n: 'mission-planner',            stage: 'spec'  },
        { n: 'autonomy-manager (AI harness)', stage: 'spec' },
        { n: 'mode-manager (applies mode)',   stage: 'spec' },
        { n: 'rover brain (Hermes · M3)',  stage: 'spec'  },
      ],
      milestones: [
        { t: 'Phases 0–4: foundation → walking skeleton → closed-loop → CC boundary → safety', done: true, proof: 'friday-labs-os main' },
        { t: 'Gazebo Stage 1: spawns, stands level, drives closed-loop', done: true, proof: 'Stage 1 - Gazebo Simulation.md' },
        { t: 'Command-envelope validator hardened (MALFORMED + fail-safe allowlist)', done: true, proof: 'a9cab99' },
        { t: 'Pi 4B live bring-up A1–A2: Ubuntu 24.04 + Jazzy + module registry', done: true, proof: 'verified live 2026-07-07' },
        { t: 'Phase A3: micro-ROS agent — first-class Core OS service (udev serial + WiFi/UDP)', done: true, proof: 'db8bca5 · PR #4' },
        { t: 'os-control agent: live OS service control from the FCC (start/stop/restart · polkit-scoped · audited)', done: true, proof: 'friday-core-os PR #5' },
        { t: 'SOUL.md brain-context store on the Core Hub (persisted from the FCC Brain page; fail-closed, fsync-durable)', done: true, proof: 'friday-core-os PR #6' },
        { t: 'Operating-mode store on the Core Hub (autonomy × profile × brain, allowlist-validated, audited)', done: true, proof: 'friday-core-os PR #7' },
        { t: 'Rover brain: vanilla Hermes stripped 990k LOC → self-learning rover AI, smoke-green', done: true, proof: 'friday-rover-brain e87f526' },
        { t: 'Rover brain deployed + first live mission turn (MiniMax-M3)', done: false, proof: null },
        { t: 'WireGuard tunnel + remaining Phase B/C/D services', done: false, proof: null },
        { t: 'autonomy-manager node (hosts the rover brain on the Core Hub)', done: false, proof: null },
      ],
    },

    tel: {
      stage: 'spec',
      repos: 'friday-telemetry-os',
      next: 'Build the Debian 12 Lite image for the Pi 3B+',
      submodules: [
        { n: 'mosquitto-relay',        stage: 'spec' },
        { n: 'modem-manager (2× 4G)',  stage: 'spec' },
        { n: 'network-router (failover)', stage: 'spec' },
        { n: 'lora-bridge',            stage: 'spec' },
        { n: 'health-beacon',          stage: 'spec' },
        { n: 'esp32-watchdog',         stage: 'spec' },
      ],
      milestones: [
        { t: 'Two-OS split spec: Debian 12 Lite, no ROS 2, pure gateway', done: true, proof: '4b3f5d1' },
        { t: 'Gateway service set defined (relay, modems, failover, beacon)', done: true, proof: 'Mark 1 Compute Architecture.md' },
        { t: 'Pi 3B+ image build + first boot', done: false, proof: null },
        { t: 'Dual 4G failover bench test (Jio + Airtel dongles)', done: false, proof: null },
        { t: 'Backup ESP32 LoRa beacon firmware', done: false, proof: null },
      ],
    },

    loco: {
      stage: 'bench',
      repos: 'friday-labs-os · friday-mobility-firmware',
      next: 'ESP32 motor firmware: PCNT encoders + DRV8871 PWM + safe-stop WDT + module-agent contract',
      submodules: [
        { n: 'ESP32 micro-ROS link (domain 42)', stage: 'bench' },
        { n: 'mobility-heartbeat (1 Hz)',  stage: 'bench' },
        { n: 'LED / GPIO control',         stage: 'bench' },
        { n: 'kinematics + 5-check gate',  stage: 'sim'   },
        { n: 'safe-stop handler (107 ms)', stage: 'sim'   },
        { n: 'odometry-estimator (encoders)', stage: 'spec' },
        { n: 'motor-control-loop (DRV8871)', stage: 'spec' },
        { n: 'steering-control-loop',      stage: 'spec'  },
        { n: 'stall-detector',             stage: 'spec'  },
      ],
      milestones: [
        { t: 'Kinematics + 5-check safety gate + agent node, unit-tested', done: true, proof: 'friday_locomotion tests 15/15' },
        { t: 'Rocker-bogie URDF drives in Gazebo; safe-stop measured 107 ms', done: true, proof: 'Stage 1 · Phase 4' },
        { t: 'Motors + electronics procured (6× XD-37GB555, DRV8871, BNO085)', done: true, proof: '242a33e BOM' },
        { t: 'Wheel v2 CAD released; 130 mm wheels in production', done: true, proof: 'MK1_Wheel_v2_REPORT.md' },
        { t: '3× ESP32 flashed; one live on the Core Hub ROS graph — dedicated-UART micro-ROS, domain 42, 1 Hz heartbeat + LED control', done: true, proof: 'board 8c:94:df live 2026-07-09' },
        { t: 'ESP32 motor firmware (PCNT encoders, DRV8871 PWM, 100 ms WDT, module-agent contract)', done: false, proof: null },
        { t: 'Bench motor spin: one corner closed-loop on encoder', done: false, proof: null },
      ],
    },

    lab: {
      stage: 'spec',
      repos: 'friday-researchdeck-os',
      next: 'Acquire Pi 5 8 GB + AI HAT+ 2 (Hailo-10H) — on-rover brain + vision',
      submodules: [
        { n: 'sensor-plugin-manager (hotplug)', stage: 'spec' },
        { n: 'lidar / camera capture',     stage: 'spec' },
        { n: 'Coral / Hailo inference',    stage: 'spec' },
        { n: 'mapping-service (SLAM)',     stage: 'spec' },
        { n: 'research-data-logger (MCAP)', stage: 'spec' },
        { n: 'processed-data gate',        stage: 'spec' },
      ],
      milestones: [
        { t: 'Repo scaffolded: 8 systemd services, 4 sensor profiles, udev hotplug', done: true, proof: 'pushed 2026-07-01' },
        { t: 'Data-gate contract: only processed outputs cross to Core', done: true, proof: 'Mark 1 Compute Architecture.md' },
        { t: 'Pi 5 8 GB + AI HAT+ 2 (Hailo-10H, 40 TOPS) in hand', done: false, proof: null },
        { t: 'On-device LLM (rover brain) + Hailo vision live on bench', done: false, proof: null },
        { t: 'First sensor profile live (agriculture)', done: false, proof: null },
      ],
    },

    bay: {
      stage: 'spec',
      repos: 'ESP32-S3 firmware (planned)',
      next: 'Deferred until locomotion is on the bench',
      submodules: [
        { n: 'spark-bay-controller',       stage: 'spec' },
        { n: 'launch-sequence-manager',    stage: 'spec' },
        { n: 'docking-state-monitor',      stage: 'spec' },
        { n: 'charging-monitor',           stage: 'spec' },
        { n: 'bay-safety-checker (8 interlocks)', stage: 'spec' },
      ],
      milestones: [
        { t: 'Bay spec locked: V-cradle, servo lock, 8 pre-launch interlocks', done: true, proof: 'Mark 1 Compute Architecture.md' },
        { t: 'ESP32-S3 firmware (spark-bay-controller, launch sequencer)', done: false, proof: null },
        { t: 'Bay hardware build + interlock bench test', done: false, proof: null },
      ],
    },

    cc: {
      stage: 'bench',
      repos: 'friday-command-center (FCC)',
      next: 'Rover-side mode-manager + rover-brain deploy; then end-to-end vs sim rover',
      submodules: [
        { n: 'gateway (edge + read)',      stage: 'bench' },
        { n: 'dispatcher (command write)', stage: 'bench' },
        { n: 'control-plane (Frappe)',     stage: 'bench' },
        { n: 'EMQX broker (mTLS)',         stage: 'bench' },
        { n: 'signed CBOR envelope',       stage: 'bench' },
        { n: 'edge cache (Keystone P0)',   stage: 'bench' },
        { n: 'Carbon console (8 pages)',   stage: 'bench' },
        { n: 'live OS control (System)',   stage: 'bench' },
        { n: 'SOUL.md editor (Brain)',     stage: 'bench' },
        { n: 'mode config (Modes)',        stage: 'bench' },
        { n: 'wire lockstep v0.1.0',       stage: 'spec'  },
      ],
      milestones: [
        { t: 'FCC Phases A–D + 4 follow-ups pushed', done: true, proof: 'friday-command-center main' },
        { t: 'Signed CBOR protocol interop (golden wire vectors)', done: true, proof: 'test_protocol_golden.py' },
        { t: 'v16 bench setup running', done: true, proof: 'FCC bench notes' },
        { t: 'Keystone P0: durable edge cache + edge-owned nonce (survives control-plane outage)', done: true, proof: '2118edd' },
        { t: 'v0.1.0 wire lockstep (opaque-bstr + int64) — byte-exact vs rover CommandValidator', done: true, proof: 'PR #1 · draft (lockstep-gated)' },
        { t: 'Reframed as the Friday Labs OS control panel — 8-section UI (React 19 + Carbon g100)', done: true, proof: 'PR #2 · 15c8277' },
        { t: 'Live OS service control (System) + SOUL.md editor (Brain) wired to the Core Hub agent; security-reviewed', done: true, proof: 'PR #3 + gateway hardening' },
        { t: 'Live operating-mode activation (Modes) persisted to the Core Hub via the os-control agent', done: true, proof: 'PR #6' },
        { t: 'End-to-end vs sim rover on Legion', done: false, proof: null },
      ],
    },
  },

  links: {
    'cc-tel':    { proven: 'bench', note: 'FCC ↔ rover telemetry agent direct; Pi 3B+ gateway relay pending' },
    'tel-core':  { proven: 'none',  note: 'internal MQTT bridge designed; gateway not built yet' },
    'core-loco': { proven: 'bench', note: 'real ESP32 live on the Core Hub ROS graph via dedicated-UART micro-ROS (domain 42, 2026-07-09) — transport bench-proven; closed-loop drive + 107 ms safe-stop still Gazebo (sim); ESP32 motor firmware next' },
    'core-lab':  { proven: 'none',  note: 'data-gate contract defined; no Pi 5 yet' },
    'core-bay':  { proven: 'none',  note: 'spec only' },
  },
};
