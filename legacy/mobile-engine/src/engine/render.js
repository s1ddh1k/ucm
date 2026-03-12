import { clamp, lerp } from "./math.js";

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;
    this.pixelRatio = 1;
    this.spritePalette = {
      player: { fill: "#7cf0d5", stroke: "#15353a" },
      seeker: { fill: "#ff7b7b", stroke: "#461a1a" },
      shard: { fill: "#ffd66c", stroke: "#5b4610" },
      neutral: { fill: "#8ba7af", stroke: "#20343c" },
    };
  }

  resize(width, height, pixelRatio) {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
  }

  render(scene, input) {
    const ctx = this.context;
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.scale(this.pixelRatio, this.pixelRatio);

    const viewportWidth = this.canvas.clientWidth;
    const viewportHeight = this.canvas.clientHeight;
    const camera = scene.camera;
    camera.zoom = lerp(camera.zoom, 1, 0.2);

    this.paintBackground(ctx, scene, viewportWidth, viewportHeight);

    ctx.save();
    ctx.translate(viewportWidth * 0.5, viewportHeight * 0.5);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    this.paintArena(ctx, scene);
    for (const entity of scene.entities) {
      this.drawEntity(ctx, entity);
    }
    ctx.restore();

    this.paintTouchControls(ctx, input, viewportWidth, viewportHeight);
    ctx.restore();
  }

  paintBackground(ctx, scene, viewportWidth, viewportHeight) {
    const gradient = ctx.createLinearGradient(0, 0, 0, viewportHeight);
    gradient.addColorStop(0, "#0f1b24");
    gradient.addColorStop(1, "#091117");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    ctx.fillStyle = "rgba(124, 240, 213, 0.04)";
    for (let x = 0; x < viewportWidth; x += 40) {
      ctx.fillRect(x, 0, 1, viewportHeight);
    }
    for (let y = 0; y < viewportHeight; y += 40) {
      ctx.fillRect(0, y, viewportWidth, 1);
    }
  }

  paintArena(ctx, scene) {
    const arena = scene.arena;
    ctx.fillStyle = "#0d1820";
    ctx.fillRect(0, 0, arena.width, arena.height);
    ctx.strokeStyle = "rgba(124, 169, 186, 0.18)";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, arena.width, arena.height);
  }

  drawEntity(ctx, entity) {
    const style = this.spritePalette[entity.sprite] || this.spritePalette.neutral;
    ctx.save();
    ctx.translate(entity.position.x, entity.position.y);
    ctx.rotate(entity.rotation || 0);

    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (entity.tags.has("player")) {
      ctx.fillStyle = "rgba(10, 22, 27, 0.9)";
      ctx.beginPath();
      ctx.arc(entity.radius * 0.3, -entity.radius * 0.2, entity.radius * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }

    if (entity.tags.has("shard")) {
      ctx.strokeStyle = "#fff4c3";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -entity.radius);
      ctx.lineTo(entity.radius * 0.7, 0);
      ctx.lineTo(0, entity.radius);
      ctx.lineTo(-entity.radius * 0.7, 0);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.restore();
  }

  paintTouchControls(ctx, input, viewportWidth, viewportHeight) {
    const movement = input.leftVector;
    if (input.leftPointerId !== null) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = "rgba(124, 240, 213, 0.45)";
      ctx.fillStyle = "rgba(124, 240, 213, 0.12)";
      ctx.beginPath();
      ctx.arc(input.leftOrigin.x, input.leftOrigin.y, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(
        input.leftOrigin.x + movement.x * 44,
        input.leftOrigin.y + movement.y * 44,
        18,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "rgba(248, 211, 110, 0.08)";
    ctx.strokeStyle = "rgba(248, 211, 110, 0.28)";
    ctx.beginPath();
    ctx.arc(viewportWidth - 86, viewportHeight - 86, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f8d36e";
    ctx.font = "600 14px IBM Plex Sans KR";
    ctx.textAlign = "center";
    ctx.fillText("DASH", viewportWidth - 86, viewportHeight - 82);
    ctx.restore();
  }
}
