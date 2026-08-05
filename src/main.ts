import './style.css';
import { GameAudio } from './game/audio';
import { METER_DURATION_MS, SPOT_MAP, SPOTS, TOTAL_SHOTS } from './game/config';
import { ArenaScene } from './game/scene';
import { accuracy, applyShot, ballTypeForShot, createRoundStats } from './game/scoring';
import { evaluateShot } from './game/shot';
import { loadRecords, saveRecords, updateRecord } from './game/storage';
import type { BallType, GameState, RoundStats, ShotResult, SpotId } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <main class="game-shell">
    <div id="scene-root" class="scene-root" aria-label="3D 篮球场"></div>

    <header class="brand-bar">
      <div class="brand-lockup">
        <span class="brand-kicker">ALL-STAR WEEKEND</span>
        <span class="brand-title"><b>3PT</b> CHALLENGE</span>
      </div>
      <button id="sound-button" class="icon-button" type="button" aria-label="关闭声音" title="声音">声音 开</button>
    </header>

    <section id="hud" class="hud is-hidden" aria-live="polite">
      <div class="score-block">
        <span class="hud-label">SCORE</span>
        <strong id="score-value">0</strong>
        <span class="score-max">/ 30</span>
      </div>
      <div class="hud-divider"></div>
      <div class="hud-stat"><span>球数</span><strong id="shot-value">1 / 25</strong></div>
      <div class="hud-stat"><span>命中率</span><strong id="accuracy-value">0%</strong></div>
      <div class="hud-stat"><span>连续命中</span><strong id="streak-value">0</strong></div>
      <div class="hud-stat hud-desktop"><span>绿点</span><strong id="green-value">0</strong></div>
      <div class="hud-best"><span id="spot-value">弧顶</span><small>该点最佳 <b id="best-value">0</b></small></div>
    </section>

    <section id="selector" class="selector-panel">
      <div class="selector-copy">
        <p class="eyebrow">PICK YOUR SPOT</p>
        <h1>选定你的<br><em>致胜点位</em></h1>
        <p>25 球 · 每第五球为 2 分花球<br>按住空格蓄力，松开完成出手</p>
      </div>
      <div class="spot-picker" role="group" aria-label="选择投篮位置">
        ${SPOTS.map((spot, index) => `
          <button class="spot-button" type="button" data-spot="${spot.id}">
            <span class="spot-index">0${index + 1}</span>
            <span class="spot-name">${spot.label}</span>
            <span class="spot-best">BEST <b data-best-for="${spot.id}">0</b></span>
          </button>
        `).join('')}
      </div>
    </section>

    <div id="countdown" class="countdown is-hidden" aria-live="assertive"></div>

    <div id="feedback" class="shot-feedback is-hidden" aria-live="assertive">
      <strong id="feedback-main">绿点</strong>
      <span id="feedback-sub">完美释放</span>
    </div>

    <aside id="meter" class="shot-meter is-hidden" aria-label="投篮时机条">
      <span class="meter-late">晚</span>
      <div class="meter-track">
        <div class="meter-green"></div>
        <div id="meter-fill" class="meter-fill"></div>
        <div id="meter-needle" class="meter-needle"></div>
      </div>
      <span class="meter-early">早</span>
    </aside>

    <div id="ball-rack-ui" class="ball-rack-ui is-hidden" aria-hidden="true"></div>

    <div id="control-hint" class="control-hint is-hidden">
      <span class="keycap">SPACE</span>
      <span><b>按住</b>蓄力 · <b>松开</b>投篮</span>
    </div>
    <button id="shoot-button" class="shoot-button is-hidden" type="button">按住投篮</button>

    <section id="results" class="results-panel is-hidden" aria-labelledby="results-title">
      <p class="eyebrow">FINAL RESULT</p>
      <h2 id="results-title">挑战完成</h2>
      <div class="result-score"><strong id="result-score">0</strong><span>/ 30</span></div>
      <div class="result-grid">
        <div><strong id="result-makes">0/25</strong><span>命中</span></div>
        <div><strong id="result-accuracy">0%</strong><span>命中率</span></div>
        <div><strong id="result-greens">0</strong><span>绿点</span></div>
        <div><strong id="result-streak">0</strong><span>最高连中</span></div>
      </div>
      <p id="new-record" class="new-record is-hidden">NEW SPOT RECORD</p>
      <div class="result-actions">
        <button id="restart-button" class="primary-button" type="button">再来一局</button>
        <button id="change-button" class="secondary-button" type="button">更换位置</button>
      </div>
    </section>
  </main>
`;

const get = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const sceneRoot = get<HTMLDivElement>('scene-root');
const selector = get<HTMLElement>('selector');
const hud = get<HTMLElement>('hud');
const countdown = get<HTMLDivElement>('countdown');
const meter = get<HTMLElement>('meter');
const meterFill = get<HTMLDivElement>('meter-fill');
const meterNeedle = get<HTMLDivElement>('meter-needle');
const feedback = get<HTMLDivElement>('feedback');
const feedbackMain = get<HTMLElement>('feedback-main');
const feedbackSub = get<HTMLElement>('feedback-sub');
const controlHint = get<HTMLDivElement>('control-hint');
const shootButton = get<HTMLButtonElement>('shoot-button');
const results = get<HTMLElement>('results');
const rackUi = get<HTMLDivElement>('ball-rack-ui');

const audio = new GameAudio();
const fastMode = new URLSearchParams(location.search).has('fast');
const chargeDuration = METER_DURATION_MS;
const arena = new ArenaScene(sceneRoot, () => audio.rim(), () => audio.swish(), fastMode);
let records = loadRecords();
let state: GameState = 'selecting';
let currentSpot: SpotId = 'top';
let stats: RoundStats = createRoundStats(currentSpot);
let chargeStartedAt = 0;
let chargeFrame = 0;
let currentMeter = 0;
let feedbackTimer = 0;
let countdownTimer = 0;
let roundNonce = 0;

function setHidden(element: HTMLElement, hidden: boolean): void {
  element.classList.toggle('is-hidden', hidden);
}

function renderRecords(): void {
  for (const spot of SPOTS) {
    const element = document.querySelector<HTMLElement>(`[data-best-for="${spot.id}"]`);
    if (element) element.textContent = String(records.spots[spot.id].score);
  }
}

function renderHud(): void {
  get('score-value').textContent = String(stats.score);
  get('shot-value').textContent = `${Math.min(stats.shots + 1, TOTAL_SHOTS)} / ${TOTAL_SHOTS}`;
  get('accuracy-value').textContent = `${Math.round(accuracy(stats) * 100)}%`;
  get('streak-value').textContent = String(stats.streak);
  get('green-value').textContent = String(stats.greens);
  get('spot-value').textContent = SPOT_MAP[currentSpot].label;
  get('best-value').textContent = String(records.spots[currentSpot].score);
  renderRackUi();
}

function renderRackUi(): void {
  const remaining = TOTAL_SHOTS - stats.shots;
  const rackStart = Math.floor(stats.shots / 5) * 5;
  rackUi.innerHTML = Array.from({ length: 5 }, (_, index) => {
    const shotIndex = rackStart + index;
    const used = shotIndex < stats.shots;
    const beyond = shotIndex >= TOTAL_SHOTS || remaining <= 0;
    const money = (shotIndex + 1) % 5 === 0;
    return `<span class="rack-ball${money ? ' money' : ''}${used || beyond ? ' used' : ''}"></span>`;
  }).join('');
}

function setMeter(value: number): void {
  currentMeter = Math.min(value, 1.08);
  const percent = Math.min(currentMeter, 1) * 100;
  meterFill.style.height = `${percent}%`;
  meterNeedle.style.bottom = `calc(${percent}% - 2px)`;
  meter.classList.toggle('overheld', currentMeter > 1);
}

function showFeedback(result: ShotResult): void {
  feedback.className = `shot-feedback timing-${result.timing}`;
  if (result.green) {
    feedbackMain.textContent = '绿点！';
    feedbackSub.textContent = '完美释放';
  } else {
    feedbackMain.textContent = result.timing === 'early' ? '稍早' : '稍晚';
    feedbackSub.textContent = result.made ? '命中' : '未命中';
  }
  setHidden(feedback, false);
}

function prepareBall(): void {
  if (state === 'complete') return;
  state = 'ready';
  currentMeter = 0;
  setMeter(0);
  const type = ballTypeForShot(stats.shots);
  arena.holdBall(type);
  renderHud();
  setHidden(meter, false);
  setHidden(controlHint, false);
  setHidden(shootButton, false);
  shootButton.textContent = type === 'money' ? '按住投花球 · 2 分' : '按住投篮';
  shootButton.classList.toggle('money', type === 'money');
}

function beginCharge(): void {
  if (state !== 'ready') return;
  audio.unlock();
  state = 'charging';
  chargeStartedAt = performance.now();
  shootButton.classList.add('is-charging');
  controlHint.classList.add('is-active');

  const update = () => {
    if (state !== 'charging') return;
    const elapsed = performance.now() - chargeStartedAt;
    const value = elapsed / chargeDuration;
    setMeter(value);
    arena.setCharge(value);
    if (value >= 1.08) {
      releaseShot();
      return;
    }
    chargeFrame = requestAnimationFrame(update);
  };
  chargeFrame = requestAnimationFrame(update);
}

function releaseShot(): void {
  if (state !== 'charging') return;
  cancelAnimationFrame(chargeFrame);
  setMeter((performance.now() - chargeStartedAt) / chargeDuration);
  state = 'flight';
  shootButton.classList.remove('is-charging');
  controlHint.classList.remove('is-active');
  setHidden(meter, true);
  setHidden(controlHint, true);
  setHidden(shootButton, true);

  const ballType: BallType = ballTypeForShot(stats.shots);
  const result = evaluateShot(currentMeter, ballType);
  arena.setCharge(currentMeter);
  audio.shoot();
  if (result.green) audio.green();
  showFeedback(result);

  arena.launch(result, () => settleShot(result, ballType));
}

function settleShot(result: ShotResult, ballType: BallType): void {
  if (state !== 'flight') return;
  stats = applyShot(stats, result, ballType);
  renderHud();
  audio.crowd(result.made);
  state = 'feedback';

  feedbackSub.textContent = result.green ? (result.points === 2 ? '完美花球 · +2' : '完美释放') : result.made ? `命中 · +${result.points}` : '未命中';
  window.clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => {
    setHidden(feedback, true);
    arena.cancelCharge();
    if (stats.shots >= TOTAL_SHOTS) finishRound();
    else prepareBall();
  }, fastMode ? 80 : 620);
}

function startCountdown(): void {
  const nonce = ++roundNonce;
  state = 'countdown';
  setHidden(selector, true);
  setHidden(results, true);
  setHidden(hud, false);
  setHidden(rackUi, false);
  setHidden(countdown, false);
  renderHud();
  let count = 3;
  countdown.textContent = String(count);
  window.clearInterval(countdownTimer);
  countdownTimer = window.setInterval(() => {
    if (nonce !== roundNonce) return;
    count -= 1;
    if (count > 0) {
      countdown.textContent = String(count);
      countdown.animate([{ transform: 'scale(1.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 260 });
      return;
    }
    window.clearInterval(countdownTimer);
    countdown.textContent = 'GO';
    window.setTimeout(() => {
      if (nonce !== roundNonce) return;
      setHidden(countdown, true);
      prepareBall();
    }, fastMode ? 20 : 420);
  }, fastMode ? 30 : 720);
}

function startRound(spot: SpotId): void {
  currentSpot = spot;
  stats = createRoundStats(spot);
  arena.setSpot(SPOT_MAP[spot]);
  startCountdown();
}

function finishRound(): void {
  state = 'complete';
  setHidden(meter, true);
  setHidden(controlHint, true);
  setHidden(shootButton, true);
  setHidden(feedback, true);
  setHidden(rackUi, true);

  const oldBest = records.spots[currentSpot].score;
  records = updateRecord(records, stats);
  saveRecords(records);
  renderRecords();
  renderHud();

  get('result-score').textContent = String(stats.score);
  get('result-makes').textContent = `${stats.makes}/${stats.shots}`;
  get('result-accuracy').textContent = `${Math.round(accuracy(stats) * 100)}%`;
  get('result-greens').textContent = String(stats.greens);
  get('result-streak').textContent = String(stats.bestStreak);
  setHidden(get('new-record'), stats.score <= oldBest || stats.score === 0);
  setHidden(results, false);
}

function returnToSelector(): void {
  roundNonce += 1;
  state = 'selecting';
  window.clearInterval(countdownTimer);
  window.clearTimeout(feedbackTimer);
  cancelAnimationFrame(chargeFrame);
  arena.cancelCharge();
  arena.setSpot(SPOT_MAP.top);
  setHidden(results, true);
  setHidden(hud, true);
  setHidden(meter, true);
  setHidden(rackUi, true);
  setHidden(controlHint, true);
  setHidden(shootButton, true);
  setHidden(feedback, true);
  setHidden(countdown, true);
  setHidden(selector, false);
}

function cancelInputCharge(): void {
  if (state !== 'charging') return;
  cancelAnimationFrame(chargeFrame);
  state = 'ready';
  currentMeter = 0;
  setMeter(0);
  arena.cancelCharge();
  shootButton.classList.remove('is-charging');
  controlHint.classList.remove('is-active');
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-spot]')) {
  button.addEventListener('pointerenter', () => arena.setSpot(SPOT_MAP[button.dataset.spot as SpotId]));
  button.addEventListener('focus', () => arena.setSpot(SPOT_MAP[button.dataset.spot as SpotId]));
  button.addEventListener('click', () => startRound(button.dataset.spot as SpotId));
}

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat) return;
  event.preventDefault();
  beginCharge();
});
window.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return;
  event.preventDefault();
  releaseShot();
});
window.addEventListener('blur', cancelInputCharge);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelInputCharge();
});

shootButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  shootButton.setPointerCapture(event.pointerId);
  beginCharge();
});
shootButton.addEventListener('pointerup', (event) => {
  event.preventDefault();
  releaseShot();
});
shootButton.addEventListener('pointercancel', cancelInputCharge);

get<HTMLButtonElement>('restart-button').addEventListener('click', () => startRound(currentSpot));
get<HTMLButtonElement>('change-button').addEventListener('click', returnToSelector);
get<HTMLButtonElement>('sound-button').addEventListener('click', (event) => {
  const muted = audio.toggle();
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = muted ? '声音 关' : '声音 开';
  button.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
});

renderRecords();
arena.setSpot(SPOT_MAP.top);

if (import.meta.hot) {
  import.meta.hot.dispose(() => arena.destroy());
}
