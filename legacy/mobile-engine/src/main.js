import { loadGameContent } from "./engine/assets.js";
import { GameEngine } from "./engine/core.js";
import { InputController } from "./engine/input.js";
import { Renderer } from "./engine/render.js";
import { DemoScene } from "./game/demo-scene.js";

class HudController {
  constructor() {
    this.fpsPill = document.querySelector("#fps-pill");
    this.entityPill = document.querySelector("#entity-pill");
    this.wavePill = document.querySelector("#wave-pill");
    this.playerPill = document.querySelector("#player-pill");
    this.ruleList = document.querySelector("#rule-list");
    this.runtimeLog = document.querySelector("#runtime-log");
  }

  bindRules(rules) {
    this.ruleList.innerHTML = "";
    for (const rule of rules) {
      const item = document.createElement("li");
      item.textContent = rule;
      this.ruleList.append(item);
    }
  }

  setLog(entries) {
    this.runtimeLog.innerHTML = "";
    for (const entry of entries) {
      const line = document.createElement("div");
      line.className = "runtime-line";
      line.innerHTML = `<strong>${entry.title}</strong><br />${entry.message}`;
      this.runtimeLog.append(line);
    }
  }

  setWave(value) {
    this.wavePill.textContent = `Wave ${value}`;
  }

  setEntityCount(value) {
    this.entityPill.textContent = `Entities ${value}`;
  }

  setPlayerState({ score, health, shards, target }) {
    this.playerPill.textContent = `HP ${health} | Score ${score} | Shards ${shards}/${target}`;
  }

  update(metrics) {
    this.fpsPill.textContent = `FPS ${metrics.fps}`;
  }
}

async function boot() {
  const canvas = document.querySelector("#game");
  const hud = new HudController();
  const input = new InputController(canvas);
  const renderer = new Renderer(canvas);
  const engine = new GameEngine({ canvas, input, renderer, hud });
  const content = await loadGameContent();
  const scene = new DemoScene(engine, content);

  scene.initialize();
  hud.bindRules(scene.ruleList);
  hud.setLog(scene.runtimeLog);
  engine.setScene(scene);
  engine.start();
}

boot().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<pre style="padding:16px;color:#fff;background:#100">${error.stack}</pre>`;
});
