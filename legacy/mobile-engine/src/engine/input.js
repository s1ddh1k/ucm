import { Vec2, clamp } from "./math.js";

export class InputController {
  constructor(canvas) {
    this.canvas = canvas;
    this.leftPointerId = null;
    this.rightPointerId = null;
    this.leftOrigin = new Vec2();
    this.leftVector = new Vec2();
    this.moveVector = new Vec2();
    this.dashPressed = false;
    this.keyState = new Set();
    this.justPressed = new Set();
    this.pointerPositions = new Map();
    this.install();
  }

  install() {
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.addEventListener("keyup", (event) => this.onKeyUp(event));
  }

  beginFrame() {
    this.justPressed.clear();
  }

  onPointerDown(event) {
    const position = this.toCanvasSpace(event);
    this.pointerPositions.set(event.pointerId, position);
    if (position.x < this.canvas.clientWidth * 0.5 && this.leftPointerId === null) {
      this.leftPointerId = event.pointerId;
      this.leftOrigin = position.clone();
      this.leftVector.set(0, 0);
    } else if (this.rightPointerId === null) {
      this.rightPointerId = event.pointerId;
      this.dashPressed = true;
    }
  }

  onPointerMove(event) {
    const position = this.toCanvasSpace(event);
    this.pointerPositions.set(event.pointerId, position);
    if (event.pointerId === this.leftPointerId) {
      const delta = Vec2.subtract(position, this.leftOrigin);
      const maxRadius = 60;
      const distance = Math.min(delta.length(), maxRadius);
      delta.normalize().scale(distance / maxRadius);
      this.leftVector = delta;
    }
  }

  onPointerUp(event) {
    this.pointerPositions.delete(event.pointerId);
    if (event.pointerId === this.leftPointerId) {
      this.leftPointerId = null;
      this.leftVector.set(0, 0);
    }
    if (event.pointerId === this.rightPointerId) {
      this.rightPointerId = null;
    }
  }

  onKeyDown(event) {
    if (event.repeat) {
      return;
    }
    this.keyState.add(event.code);
    this.justPressed.add(event.code);
    if (event.code === "Space") {
      this.dashPressed = true;
    }
  }

  onKeyUp(event) {
    this.keyState.delete(event.code);
  }

  getMovementVector() {
    const keyboard = new Vec2(
      (this.keyState.has("KeyD") ? 1 : 0) - (this.keyState.has("KeyA") ? 1 : 0),
      (this.keyState.has("KeyS") ? 1 : 0) - (this.keyState.has("KeyW") ? 1 : 0),
    );
    if (keyboard.length() > 0) {
      keyboard.normalize();
      this.moveVector = keyboard;
      return keyboard;
    }
    this.moveVector = this.leftVector.clone();
    return this.moveVector;
  }

  consumeDash() {
    if (!this.dashPressed) {
      return false;
    }
    this.dashPressed = false;
    return true;
  }

  toCanvasSpace(event) {
    const rect = this.canvas.getBoundingClientRect();
    return new Vec2(
      clamp(event.clientX - rect.left, 0, rect.width),
      clamp(event.clientY - rect.top, 0, rect.height),
    );
  }
}
