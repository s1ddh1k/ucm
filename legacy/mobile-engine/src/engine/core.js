import { clamp } from "./math.js";

export class Entity {
  constructor(tags = []) {
    this.id = crypto.randomUUID();
    this.tags = new Set(tags);
    this.alive = true;
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.radius = 12;
    this.rotation = 0;
    this.sprite = "neutral";
    this.update = null;
    this.render = null;
    this.data = {};
  }
}

export class Scene {
  constructor(engine) {
    this.engine = engine;
    this.entities = [];
    this.time = 0;
    this.background = "#08131b";
    this.camera = {
      x: 0,
      y: 0,
      zoom: 1,
    };
  }

  addEntity(entity) {
    this.entities.push(entity);
    return entity;
  }

  removeDeadEntities() {
    this.entities = this.entities.filter((entity) => entity.alive);
  }

  findByTag(tag) {
    return this.entities.filter((entity) => entity.tags.has(tag));
  }

  update(deltaTime) {
    this.time += deltaTime;
    for (const entity of this.entities) {
      if (entity.alive && typeof entity.update === "function") {
        entity.update(deltaTime, this, entity);
      }
      entity.position.x += entity.velocity.x * deltaTime;
      entity.position.y += entity.velocity.y * deltaTime;
    }
    this.removeDeadEntities();
  }
}

export class GameEngine {
  constructor({ canvas, input, renderer, hud }) {
    this.canvas = canvas;
    this.input = input;
    this.renderer = renderer;
    this.hud = hud;
    this.activeScene = null;
    this.fixedTimeStep = 1 / 60;
    this.accumulator = 0;
    this.lastFrameTime = 0;
    this.frameTimes = [];
    this.metrics = {
      fps: 0,
      entityCount: 0,
    };
  }

  setScene(scene) {
    this.activeScene = scene;
  }

  start() {
    const resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.round(rect.width * window.devicePixelRatio);
      this.canvas.height = Math.round(rect.height * window.devicePixelRatio);
      this.renderer.resize(this.canvas.width, this.canvas.height, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);
    requestAnimationFrame((time) => this.frame(time));
  }

  frame(timestamp) {
    if (!this.lastFrameTime) {
      this.lastFrameTime = timestamp;
    }

    const deltaSeconds = clamp((timestamp - this.lastFrameTime) / 1000, 0, 0.1);
    this.lastFrameTime = timestamp;
    this.accumulator += deltaSeconds;

    while (this.accumulator >= this.fixedTimeStep) {
      this.input.beginFrame();
      this.activeScene?.update(this.fixedTimeStep);
      this.accumulator -= this.fixedTimeStep;
    }

    this.updateMetrics(deltaSeconds);
    if (this.activeScene) {
      this.metrics.entityCount = this.activeScene.entities.length;
      this.renderer.render(this.activeScene, this.input);
      this.hud.update(this.metrics, this.activeScene);
    }

    requestAnimationFrame((time) => this.frame(time));
  }

  updateMetrics(deltaSeconds) {
    this.frameTimes.push(deltaSeconds);
    if (this.frameTimes.length > 30) {
      this.frameTimes.shift();
    }
    const average = this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length;
    this.metrics.fps = average > 0 ? Math.round(1 / average) : 0;
  }
}
