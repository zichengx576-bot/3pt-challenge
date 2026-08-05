import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { SPOTS } from './config';
import type { BallType, ShotResult, SpotDefinition } from '../types';

const HOOP = new THREE.Vector3(0, 3.05, 0);
const BALL_RADIUS = 0.12;

interface PlayerParts {
  root: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  leftUpperArm: THREE.Group;
  rightUpperArm: THREE.Group;
  leftForearm: THREE.Group;
  rightForearm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
}

export class ArenaScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  private readonly clock = new THREE.Clock();
  private readonly ballMesh: THREE.Mesh;
  private readonly normalBallMaterial = new THREE.MeshStandardMaterial({ color: 0xd95d16, roughness: 0.72, metalness: 0.02 });
  private readonly moneyBallMaterial = new THREE.MeshStandardMaterial({ color: 0x7a1e27, roughness: 0.72, metalness: 0.02 });
  private readonly ballBody: CANNON.Body;
  private readonly player: PlayerParts;
  private readonly rack = new THREE.Group();
  private net: THREE.LineSegments | null = null;
  private netBasePositions: Float32Array | null = null;
  private netAnimationStarted = -Infinity;
  private spot = SPOTS[2];
  private charge = 0;
  private shotAnimation = 0;
  private ballInFlight = false;
  private shotStart = 0;
  private onShotSettled: (() => void) | null = null;
  private previousBallY = 0;
  private swishTriggered = false;
  private animationFrame = 0;
  private lowQuality = false;
  private fpsFrames = 0;
  private fpsStarted = performance.now();
  private lastFastRender = 0;
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    private readonly onRim: () => void,
    private readonly onSwish: () => void,
    private readonly fastMode = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !fastMode, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'game-canvas';
    this.renderer.setPixelRatio(fastMode ? 1 : Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = !fastMode;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.append(this.canvas);

    this.camera = new THREE.PerspectiveCamera(44, container.clientWidth / container.clientHeight, 0.1, 80);
    this.scene.background = new THREE.Color(0x070a12);
    this.scene.fog = new THREE.FogExp2(0x070a12, 0.027);

    this.buildLighting();
    this.buildArena();
    this.buildCourt();
    this.buildHoop();
    this.buildCrowd();
    this.player = this.buildPlayer();
    this.scene.add(this.player.root);
    this.buildRack();

    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 16), this.normalBallMaterial);
    this.ballMesh.castShadow = true;
    this.ballMesh.visible = false;
    this.scene.add(this.ballMesh);
    this.addBallSeams(this.ballMesh);

    this.ballBody = new CANNON.Body({ mass: 0.62, shape: new CANNON.Sphere(BALL_RADIUS), linearDamping: 0.015 });
    this.ballBody.collisionResponse = true;
    this.world.addBody(this.ballBody);
    this.ballBody.sleep();

    this.setSpot(this.spot);
    this.resizeObserver = new ResizeObserver(() => this.resize(container));
    this.resizeObserver.observe(container);
    this.animate();
  }

  setSpot(spot: SpotDefinition): void {
    this.spot = spot;
    this.player.root.position.set(spot.x, 0, spot.z);
    this.player.root.rotation.y = Math.atan2(spot.x, spot.z);
    const side = Math.sign(spot.x) || 1;
    this.rack.position.set(spot.x + side * 0.85, 0, spot.z + 0.2);
    this.rack.rotation.y = this.player.root.rotation.y;
    this.updateCamera(true);
    this.holdBall('normal');
  }

  holdBall(type: BallType): void {
    this.ballInFlight = false;
    this.swishTriggered = false;
    this.ballBody.sleep();
    this.ballBody.velocity.setZero();
    this.ballBody.angularVelocity.setZero();
    this.ballMesh.visible = true;
    this.ballMesh.material = type === 'money' ? this.moneyBallMaterial : this.normalBallMaterial;
    this.updateHeldBall();
  }

  setCharge(value: number): void {
    this.charge = THREE.MathUtils.clamp(value, 0, 1.08);
  }

  cancelCharge(): void {
    this.charge = 0;
    this.shotAnimation = 0;
  }

  launch(result: ShotResult, onSettled: () => void): void {
    this.onShotSettled = onSettled;
    this.ballInFlight = true;
    this.shotStart = performance.now();
    this.shotAnimation = 1;
    this.ballBody.wakeUp();
    const start = this.heldBallWorldPosition();
    this.ballBody.position.set(start.x, start.y, start.z);

    const distance = Math.hypot(start.x - HOOP.x, start.z - HOOP.z);
    const flightTime = THREE.MathUtils.clamp(0.92 + distance * 0.045, 1.05, 1.28);
    const missDirection = result.timing === 'early' ? 1 : -1;
    const target = HOOP.clone();
    target.y += result.made ? 0.02 : 0.08;
    if (!result.made) {
      const severity = THREE.MathUtils.clamp(result.error * 2.6, 0.14, 0.52);
      target.x += missDirection * (0.22 + severity * 0.55) + (Math.random() - 0.5) * 0.16;
      target.z += result.timing === 'late' ? -0.18 - severity * 0.24 : 0.16 + severity * 0.2;
    }

    const vx = (target.x - start.x) / flightTime;
    const vz = (target.z - start.z) / flightTime;
    const vy = (target.y - start.y + 4.91 * flightTime * flightTime) / flightTime;
    this.ballBody.velocity.set(vx, vy, vz);
    this.ballBody.angularVelocity.set(2.5, -vx * 1.4, 1.8);
    this.previousBallY = start.y;

    if (result.made && !this.fastMode) {
      const activeShot = this.shotStart;
      window.setTimeout(() => {
        if (this.ballInFlight && this.shotStart === activeShot) this.registerSwish();
      }, flightTime * 1000);
    }

    if (this.fastMode) {
      window.setTimeout(() => this.finishActiveShot(), 150);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private buildLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xaecbff, 0x15100d, 1.55));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(-5, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 11;
    key.shadow.camera.bottom = -4;
    this.scene.add(key);

    const rim = new THREE.PointLight(0xff532e, 38, 15, 2);
    rim.position.set(0, 7.5, -2.5);
    this.scene.add(rim);
    const cool = new THREE.PointLight(0x4f8fff, 30, 18, 2);
    cool.position.set(-8, 8, 5);
    this.scene.add(cool);
  }

  private buildArena(): void {
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x171a22, roughness: 0.9 });
    const outerFloor = new THREE.Mesh(new THREE.CircleGeometry(18, 64), floorMaterial);
    outerFloor.rotation.x = -Math.PI / 2;
    outerFloor.receiveShadow = true;
    this.scene.add(outerFloor);

    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 19, 5, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x111522, side: THREE.BackSide, roughness: 0.84 }),
    );
    roof.position.y = 5.8;
    this.scene.add(roof);

    const ribbonTexture = this.makeRibbonTexture();
    const ribbon = new THREE.Mesh(
      new THREE.CylinderGeometry(13.3, 13.3, 0.65, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: ribbonTexture, side: THREE.BackSide, color: 0xffffff }),
    );
    ribbon.position.y = 4.7;
    this.scene.add(ribbon);
  }

  private buildCourt(): void {
    const court = new THREE.Mesh(
      new THREE.PlaneGeometry(15.2, 18),
      new THREE.MeshStandardMaterial({ map: this.makeWoodTexture(), roughness: 0.58, metalness: 0.03 }),
    );
    court.rotation.x = -Math.PI / 2;
    court.position.z = 3.8;
    court.position.y = 0.012;
    court.receiveShadow = true;
    this.scene.add(court);

    const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);

    const white = new THREE.LineBasicMaterial({ color: 0xf4efe4, transparent: true, opacity: 0.88 });
    const arcPoints: THREE.Vector3[] = [];
    for (let step = 0; step <= 60; step += 1) {
      const angle = THREE.MathUtils.degToRad(13 + (154 * step) / 60);
      arcPoints.push(new THREE.Vector3(Math.cos(angle) * 6.75, 0.035, Math.sin(angle) * 6.75));
    }
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPoints), white));

    for (const x of [-6.75, 6.75]) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.035, -0.05), new THREE.Vector3(x, 0.035, 1.55)]),
        white,
      );
      this.scene.add(line);
    }

    const centerLogo = new THREE.Mesh(
      new THREE.CircleGeometry(1.28, 48),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.55, emissive: 0x101f45, emissiveIntensity: 0.4 }),
    );
    centerLogo.rotation.x = -Math.PI / 2;
    centerLogo.position.set(0, 0.027, 7.1);
    this.scene.add(centerLogo);

    for (const [index, spot] of SPOTS.entries()) {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.34, 0.42, 28),
        new THREE.MeshBasicMaterial({ color: index === 2 ? 0x55e7ff : 0xff653a, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(spot.x, 0.045, spot.z);
      this.scene.add(marker);
    }
  }

  private buildHoop(): void {
    const supportMaterial = new THREE.MeshStandardMaterial({ color: 0x151922, metalness: 0.75, roughness: 0.3 });
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.2, 0.32), supportMaterial);
    pole.position.set(0, 1.6, -1.35);
    pole.castShadow = true;
    this.scene.add(pole);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1.1), supportMaterial);
    arm.position.set(0, 3.1, -0.83);
    this.scene.add(arm);

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.82, 1.05, 0.055),
      new THREE.MeshPhysicalMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.4, roughness: 0.12, transmission: 0.45 }),
    );
    board.position.set(0, 3.45, -0.37);
    board.castShadow = true;
    this.scene.add(board);
    const boardBody = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.91, 0.525, 0.03)) });
    boardBody.position.set(0, 3.45, -0.37);
    this.world.addBody(boardBody);

    const square = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.58, 0.43)),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    square.position.set(0, 3.22, -0.335);
    this.scene.add(square);

    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xff4a1f, metalness: 0.55, roughness: 0.3 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.026, 10, 36), rimMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(HOOP);
    rim.castShadow = true;
    this.scene.add(rim);

    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2;
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(0.026) });
      body.position.set(Math.cos(angle) * 0.23, HOOP.y, Math.sin(angle) * 0.23);
      this.world.addBody(body);
    }

    const netMaterial = new THREE.LineBasicMaterial({ color: 0xf5f1e8, transparent: true, opacity: 0.82 });
    const netPoints: THREE.Vector3[] = [];
    const strandCount = 14;
    const segmentCount = 4;
    for (let strand = 0; strand < strandCount; strand += 1) {
      const baseAngle = (strand / strandCount) * Math.PI * 2;
      const nodes: THREE.Vector3[] = [];
      for (let node = 0; node <= segmentCount; node += 1) {
        const progress = node / segmentCount;
        const radius = THREE.MathUtils.lerp(0.225, 0.135, progress);
        const angle = baseAngle + progress * 0.18;
        nodes.push(new THREE.Vector3(
          Math.cos(angle) * radius,
          HOOP.y - 0.02 - progress * 0.58,
          Math.sin(angle) * radius,
        ));
      }
      for (let node = 0; node < segmentCount; node += 1) {
        netPoints.push(nodes[node], nodes[node + 1]);
      }
    }
    const netGeometry = new THREE.BufferGeometry().setFromPoints(netPoints);
    const netPosition = netGeometry.getAttribute('position') as THREE.BufferAttribute;
    netPosition.setUsage(THREE.DynamicDrawUsage);
    this.net = new THREE.LineSegments(netGeometry, netMaterial);
    this.netBasePositions = new Float32Array(netPosition.array);
    this.scene.add(this.net);
  }

  private buildCrowd(): void {
    const mobile = matchMedia('(max-width: 700px)').matches;
    const count = this.fastMode ? 80 : mobile ? 360 : 620;
    const geometry = new THREE.BoxGeometry(0.16, 0.3, 0.14);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true });
    const crowd = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const palette = [0xe6e8ee, 0x263d70, 0xd64b31, 0x151c2e, 0xe4b441];
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 9.1 + Math.random() * 3.4;
      const y = 0.45 + (radius - 8.8) * 0.78 + Math.random() * 0.18;
      matrix.makeRotationY(-angle);
      matrix.setPosition(Math.cos(angle) * radius, y, Math.sin(angle) * radius + 2.2);
      crowd.setMatrixAt(index, matrix);
      crowd.setColorAt(index, color.setHex(palette[index % palette.length]));
    }
    crowd.instanceMatrix.needsUpdate = true;
    crowd.frustumCulled = false;
    this.scene.add(crowd);
  }

  private buildPlayer(): PlayerParts {
    const root = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0x71442e, roughness: 0.75 });
    const jersey = new THREE.MeshStandardMaterial({ color: 0x17376f, roughness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff552e, roughness: 0.45 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xf4f6fb, roughness: 0.5 });
    const shorts = new THREE.MeshStandardMaterial({ color: 0x101c38, roughness: 0.7 });
    const makeMesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      return mesh;
    };

    const torso = makeMesh(new THREE.CapsuleGeometry(0.28, 0.68, 6, 12), jersey);
    torso.position.y = 1.5;
    root.add(torso);
    const waistStripe = makeMesh(new THREE.BoxGeometry(0.54, 0.07, 0.31), accent);
    waistStripe.position.set(0, 1.19, 0);
    root.add(waistStripe);
    const leftSidePanel = makeMesh(new THREE.BoxGeometry(0.055, 0.65, 0.31), trim);
    const rightSidePanel = leftSidePanel.clone();
    leftSidePanel.position.set(-0.265, 1.45, 0);
    rightSidePanel.position.set(0.265, 1.45, 0);
    root.add(leftSidePanel, rightSidePanel);

    const jerseyBack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.56),
      new THREE.MeshBasicMaterial({ map: this.makeJerseyTexture(), transparent: true, depthWrite: false }),
    );
    jerseyBack.position.set(0, 0.03, 0.282);
    torso.add(jerseyBack);
    const head = makeMesh(new THREE.SphereGeometry(0.19, 18, 14), skin);
    head.position.y = 2.16;
    root.add(head);

    const limb = (radius: number, length: number, material: THREE.Material) => {
      const pivot = new THREE.Group();
      const mesh = makeMesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material);
      mesh.position.y = -length * 0.5;
      pivot.add(mesh);
      return pivot;
    };

    const leftUpperArm = limb(0.085, 0.42, skin);
    const rightUpperArm = limb(0.085, 0.42, skin);
    leftUpperArm.position.set(-0.34, 1.83, 0);
    rightUpperArm.position.set(0.34, 1.83, 0);
    root.add(leftUpperArm, rightUpperArm);

    const leftForearm = limb(0.075, 0.42, skin);
    const rightForearm = limb(0.075, 0.42, skin);
    leftForearm.position.y = -0.42;
    rightForearm.position.y = -0.42;
    leftUpperArm.add(leftForearm);
    rightUpperArm.add(rightForearm);

    const leftLeg = limb(0.105, 0.72, shorts);
    const rightLeg = limb(0.105, 0.72, shorts);
    leftLeg.position.set(-0.16, 1.08, 0);
    rightLeg.position.set(0.16, 1.08, 0);
    root.add(leftLeg, rightLeg);
    const leftShoe = makeMesh(new THREE.BoxGeometry(0.2, 0.12, 0.36), trim);
    const rightShoe = leftShoe.clone();
    leftShoe.position.set(-0.16, 0.08, -0.08);
    rightShoe.position.set(0.16, 0.08, -0.08);
    root.add(leftShoe, rightShoe);

    return { root, torso, head, leftUpperArm, rightUpperArm, leftForearm, rightForearm, leftLeg, rightLeg };
  }

  private buildRack(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x454b55, metalness: 0.8, roughness: 0.3 });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.12), metal);
    rail.position.y = 0.56;
    this.rack.add(rail);
    for (const y of [0.35, 0.72, 1.09]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 0.55), metal);
      shelf.position.y = y;
      shelf.rotation.z = 0.08;
      this.rack.add(shelf);
    }
    const miniBallMaterial = new THREE.MeshStandardMaterial({ color: 0xd95d16, roughness: 0.75 });
    for (let index = 0; index < 3; index += 1) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), miniBallMaterial);
      ball.position.set(0, 0.51 + index * 0.37, 0);
      this.rack.add(ball);
    }
    this.scene.add(this.rack);
  }

  private addBallSeams(ball: THREE.Mesh): void {
    const seamMaterial = new THREE.MeshBasicMaterial({ color: 0x24100a });
    for (const rotation of [new THREE.Euler(0, 0, 0), new THREE.Euler(Math.PI / 2, 0, 0)]) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(BALL_RADIUS * 1.002, 0.005, 4, 24), seamMaterial);
      seam.rotation.copy(rotation);
      ball.add(seam);
    }
  }

  private makeWoodTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#b7773f';
    context.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 32) {
      context.fillStyle = x % 64 === 0 ? '#c98a4e' : '#ad6d39';
      context.fillRect(x, 0, 30, 512);
      context.fillStyle = 'rgba(70,35,15,.16)';
      context.fillRect(x + 30, 0, 2, 512);
    }
    for (let y = 0; y < 512; y += 64) {
      context.fillStyle = 'rgba(255,255,255,.055)';
      context.fillRect(0, y, 512, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.2, 2.8);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  private makeRibbonTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 96;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d74122';
    context.fillRect(0, 0, 1024, 96);
    context.fillStyle = '#172b64';
    context.fillRect(330, 0, 364, 96);
    context.fillStyle = '#ffffff';
    context.font = '800 42px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('3PT CHALLENGE   •   MAKE YOUR MOMENT', 512, 50);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = 3;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private makeJerseyTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 320;
    const context = canvas.getContext('2d')!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.strokeStyle = '#0a1730';
    context.lineJoin = 'round';
    context.lineWidth = 9;
    context.font = '800 39px Arial Narrow, Arial';
    context.strokeText('ALL STAR', 128, 64);
    context.fillStyle = '#f6f7fb';
    context.fillText('ALL STAR', 128, 64);
    context.font = '900 150px Impact, Arial Black';
    context.strokeText('23', 128, 190);
    context.fillStyle = '#ff552e';
    context.fillText('23', 128, 190);
    context.fillStyle = '#5be3ff';
    context.fillRect(66, 285, 124, 8);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  private heldBallWorldPosition(): THREE.Vector3 {
    const local = new THREE.Vector3(0, 1.45 + this.charge * 0.58, -0.33 - this.charge * 0.08);
    return this.player.root.localToWorld(local);
  }

  private updateHeldBall(): void {
    if (this.ballInFlight) return;
    this.ballMesh.position.copy(this.heldBallWorldPosition());
    this.ballMesh.rotation.x += 0.006;
  }

  private updatePlayer(delta: number): void {
    const release = this.shotAnimation > 0 ? Math.max(0, 1 - (performance.now() - this.shotStart) / 520) : 0;
    this.shotAnimation = release;
    const pose = Math.max(this.charge, release);
    const chargePose = Math.min(this.charge, 1);
    const crouch = Math.sin(Math.min(this.charge, 1) * Math.PI) * 0.12;
    this.player.root.position.y = -crouch + (release > 0.45 ? Math.sin((1 - release) * Math.PI) * 0.08 : 0);
    this.player.torso.rotation.x = -pose * 0.08;
    const upperArmLift = 0.3 + chargePose * 0.9 + release * 0.35;
    const elbowBend = 1 - chargePose * 0.3 - release * 0.45;
    const handInward = 0.12 + pose * 0.42;
    this.player.leftUpperArm.rotation.x = upperArmLift;
    this.player.rightUpperArm.rotation.x = upperArmLift;
    this.player.leftUpperArm.rotation.z = 0.11;
    this.player.rightUpperArm.rotation.z = -0.11;
    this.player.leftForearm.rotation.x = elbowBend;
    this.player.rightForearm.rotation.x = elbowBend;
    this.player.leftForearm.rotation.z = handInward;
    this.player.rightForearm.rotation.z = -handInward;
    this.player.leftLeg.rotation.x = crouch * 1.4;
    this.player.rightLeg.rotation.x = crouch * 1.4;
    this.player.head.rotation.y = Math.sin(performance.now() * 0.0012) * 0.025;
    if (!this.ballInFlight) this.updateHeldBall();
    this.ballMesh.rotation.x += delta * 1.5;
  }

  private updateCamera(immediate = false): void {
    const forward = new THREE.Vector3(-this.spot.x, 0, -this.spot.z).normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const base = new THREE.Vector3(this.spot.x, 2.45, this.spot.z)
      .addScaledVector(forward, -3.4)
      .addScaledVector(right, this.spot.x > 0 ? 0.55 : -0.55);
    let desired = base;
    let lookTarget = new THREE.Vector3(this.spot.x, 1.45, this.spot.z).lerp(HOOP, 0.58);
    if (this.ballInFlight) {
      desired = base.clone().lerp(new THREE.Vector3(this.spot.x * 0.48, 3.1, this.spot.z * 0.48 + 1), 0.22);
      lookTarget = this.ballMesh.position.clone().lerp(HOOP, 0.55);
    }
    const factor = immediate ? 1 : 0.075;
    this.camera.position.lerp(desired, factor);
    const currentDirection = new THREE.Vector3();
    this.camera.getWorldDirection(currentDirection);
    const currentTarget = this.camera.position.clone().add(currentDirection.multiplyScalar(8));
    currentTarget.lerp(lookTarget, immediate ? 1 : 0.11);
    this.camera.lookAt(currentTarget);
  }

  private updatePhysics(delta: number): void {
    if (!this.ballInFlight) return;
    this.world.step(1 / 60, Math.min(delta, 0.033), 2);
    this.ballMesh.position.set(this.ballBody.position.x, this.ballBody.position.y, this.ballBody.position.z);
    this.ballMesh.quaternion.set(
      this.ballBody.quaternion.x,
      this.ballBody.quaternion.y,
      this.ballBody.quaternion.z,
      this.ballBody.quaternion.w,
    );

    const elapsed = performance.now() - this.shotStart;
    const radialDistance = Math.hypot(this.ballBody.position.x - HOOP.x, this.ballBody.position.z - HOOP.z);
    if (!this.swishTriggered && this.previousBallY > HOOP.y && this.ballBody.position.y <= HOOP.y && radialDistance < 0.16) {
      this.registerSwish();
    }
    this.previousBallY = this.ballBody.position.y;

    if (elapsed > 900 && radialDistance < 0.5 && this.ballBody.position.y < HOOP.y + 0.18 && !this.swishTriggered) {
      this.onRim();
    }
    if (elapsed > 2250 || this.ballBody.position.y < -0.5) this.finishActiveShot();
  }

  private finishActiveShot(): void {
    if (!this.ballInFlight || !this.onShotSettled) return;
    this.ballInFlight = false;
    this.ballMesh.visible = false;
    this.ballBody.sleep();
    const callback = this.onShotSettled;
    this.onShotSettled = null;
    callback();
  }

  private registerSwish(): void {
    if (this.swishTriggered) return;
    this.swishTriggered = true;
    this.netAnimationStarted = performance.now();
    this.onSwish();
  }

  private updateNet(now: number): void {
    if (!this.net || !this.netBasePositions || !Number.isFinite(this.netAnimationStarted)) return;
    const elapsed = (now - this.netAnimationStarted) / 1000;
    const position = this.net.geometry.getAttribute('position') as THREE.BufferAttribute;
    const values = position.array as Float32Array;
    values.set(this.netBasePositions);

    if (elapsed >= 1.15) {
      position.needsUpdate = true;
      this.netAnimationStarted = -Infinity;
      return;
    }

    const impact = Math.sin(Math.min(elapsed / 0.42, 1) * Math.PI);
    const decay = Math.exp(-elapsed * 2.7);
    for (let index = 0; index < values.length / 3; index += 1) {
      const offset = index * 3;
      const baseX = this.netBasePositions[offset];
      const baseY = this.netBasePositions[offset + 1];
      const baseZ = this.netBasePositions[offset + 2];
      const weight = THREE.MathUtils.clamp((HOOP.y - baseY) / 0.62, 0, 1);
      const radialLength = Math.hypot(baseX, baseZ) || 1;
      const flutter = Math.sin(elapsed * 23 + index * 0.71) * 0.055 * weight * decay;
      values[offset] = baseX + (baseX / radialLength) * flutter;
      values[offset + 1] = baseY - impact * 0.16 * weight + Math.sin(elapsed * 27 + index) * 0.018 * weight * decay;
      values[offset + 2] = baseZ + (baseZ / radialLength) * flutter;
    }
    position.needsUpdate = true;
  }

  private adaptQuality(now: number): void {
    if (this.lowQuality || now - this.fpsStarted > 4200) return;
    this.fpsFrames += 1;
    const elapsed = now - this.fpsStarted;
    if (elapsed < 3000) return;
    const fps = (this.fpsFrames * 1000) / elapsed;
    if (fps < 47) {
      this.lowQuality = true;
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
    }
  }

  private animate = (): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    const now = performance.now();
    if (this.fastMode && this.lastFastRender > 0) return;
    this.lastFastRender = now;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.updatePlayer(delta);
    this.updatePhysics(delta);
    this.updateNet(now);
    this.updateCamera();
    this.adaptQuality(now);
    this.renderer.render(this.scene, this.camera);
  };

  private resize(container: HTMLElement): void {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
