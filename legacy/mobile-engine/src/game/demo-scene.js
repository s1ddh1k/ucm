import { Entity, Scene } from "../engine/core.js";
import { Vec2, clamp, randomRange } from "../engine/math.js";

function spawnShard(scene) {
  const shard = new Entity(["pickup", "shard"]);
  shard.radius = 11;
  shard.sprite = "shard";
  shard.position.x = randomRange(90, scene.arena.width - 90);
  shard.position.y = randomRange(90, scene.arena.height - 90);
  shard.update = (deltaTime, currentScene, entity) => {
    entity.rotation += deltaTime * 1.8;
  };
  scene.addEntity(shard);
}

function keepInsideArena(entity, arena) {
  entity.position.x = clamp(entity.position.x, entity.radius, arena.width - entity.radius);
  entity.position.y = clamp(entity.position.y, entity.radius, arena.height - entity.radius);
}

function flashLog(scene, title, message) {
  scene.runtimeLog.unshift({ title, message });
  scene.runtimeLog = scene.runtimeLog.slice(0, 8);
  scene.engine.hud.setLog(scene.runtimeLog);
}

function spawnSeeker(scene) {
  const template = scene.content.prefabs.seeker;
  const seeker = new Entity(["enemy", "seeker"]);
  seeker.radius = template.radius;
  seeker.sprite = template.sprite;
  seeker.data.damage = template.damage;
  seeker.data.value = template.value;
  seeker.data.speed = template.speed + (scene.wave - 1) * 14;

  const side = Math.floor(Math.random() * 4);
  if (side === 0) {
    seeker.position.x = 40;
    seeker.position.y = randomRange(40, scene.arena.height - 40);
  } else if (side === 1) {
    seeker.position.x = scene.arena.width - 40;
    seeker.position.y = randomRange(40, scene.arena.height - 40);
  } else if (side === 2) {
    seeker.position.x = randomRange(40, scene.arena.width - 40);
    seeker.position.y = 40;
  } else {
    seeker.position.x = randomRange(40, scene.arena.width - 40);
    seeker.position.y = scene.arena.height - 40;
  }

  seeker.update = (deltaTime, currentScene, entity) => {
    const player = currentScene.player;
    if (!player || !player.alive) {
      return;
    }
    const direction = Vec2.subtract(player.position, entity.position).normalize();
    entity.velocity.x = direction.x * entity.data.speed;
    entity.velocity.y = direction.y * entity.data.speed;
    entity.rotation = Math.atan2(direction.y, direction.x);
    keepInsideArena(entity, currentScene.arena);
  };

  scene.addEntity(seeker);
}

export class DemoScene extends Scene {
  constructor(engine, content) {
    super(engine);
    this.content = content;
    this.arena = content.levels.demo.arena;
    this.wave = 1;
    this.score = 0;
    this.shardsCollected = 0;
    this.runtimeLog = [];
    this.ruleList = content.levels.demo.rules;
    this.spawnCooldown = 0.9;
    this.player = null;
  }

  initialize() {
    this.player = this.spawnPlayer();
    for (let index = 0; index < this.content.levels.demo.initialShards; index += 1) {
      spawnShard(this);
    }
    for (let index = 0; index < this.content.levels.demo.initialSeekers; index += 1) {
      spawnSeeker(this);
    }
    flashLog(this, "Scene", "Demo level initialized.");
  }

  spawnPlayer() {
    const template = this.content.prefabs.player;
    const player = new Entity(["player"]);
    player.radius = template.radius;
    player.sprite = template.sprite;
    player.position.x = this.arena.width * 0.5;
    player.position.y = this.arena.height * 0.5;
    player.data.speed = template.speed;
    player.data.dashSpeed = template.dashSpeed;
    player.data.dashCooldown = 0;
    player.data.maxHealth = template.maxHealth;
    player.data.health = template.maxHealth;
    player.data.invulnerable = 0;
    player.data.shardsToWave = 8;

    player.update = (deltaTime, scene, entity) => {
      const move = scene.engine.input.getMovementVector();
      const speed = entity.data.speed;
      entity.velocity.x = move.x * speed;
      entity.velocity.y = move.y * speed;

      if (move.length() > 0.01) {
        entity.rotation = Math.atan2(move.y, move.x);
      }

      if (entity.data.dashCooldown > 0) {
        entity.data.dashCooldown -= deltaTime;
      }

      if (scene.engine.input.consumeDash() && entity.data.dashCooldown <= 0) {
        const dashVector = move.length() > 0.1 ? move.clone().normalize() : new Vec2(1, 0);
        entity.velocity.x = dashVector.x * entity.data.dashSpeed;
        entity.velocity.y = dashVector.y * entity.data.dashSpeed;
        entity.data.dashCooldown = template.dashCooldown;
        flashLog(scene, "Player", "Dash activated.");
      }

      if (entity.data.invulnerable > 0) {
        entity.data.invulnerable -= deltaTime;
      }

      keepInsideArena(entity, scene.arena);
      scene.camera.x += (entity.position.x - scene.camera.x) * 0.12;
      scene.camera.y += (entity.position.y - scene.camera.y) * 0.12;
    };

    this.addEntity(player);
    return player;
  }

  update(deltaTime) {
    super.update(deltaTime);
    this.resolveCollisions();
    this.progressWave(deltaTime);
    this.engine.hud.setWave(this.wave);
    this.engine.hud.setEntityCount(this.entities.length);
    this.engine.hud.setPlayerState({
      score: this.score,
      health: this.player.data.health,
      shards: this.shardsCollected,
      target: this.player.data.shardsToWave,
    });
  }

  resolveCollisions() {
    const player = this.player;
    if (!player || !player.alive) {
      return;
    }

    for (const shard of this.findByTag("pickup")) {
      if (Vec2.distance(player.position, shard.position) <= player.radius + shard.radius) {
        shard.alive = false;
        this.score += 5;
        this.shardsCollected += 1;
        flashLog(this, "Pickup", `Energy shard collected (${this.shardsCollected}/${player.data.shardsToWave}).`);
        spawnShard(this);
      }
    }

    for (const enemy of this.findByTag("enemy")) {
      if (Vec2.distance(player.position, enemy.position) <= player.radius + enemy.radius) {
        if (player.data.invulnerable <= 0) {
          player.data.health -= enemy.data.damage;
          player.data.invulnerable = 1.0;
          flashLog(this, "Impact", `Player hit. Health ${player.data.health}/${player.data.maxHealth}.`);
          if (player.data.health <= 0) {
            player.data.health = player.data.maxHealth;
            this.score = Math.max(0, this.score - 25);
            this.wave = 1;
            this.shardsCollected = 0;
            flashLog(this, "Reset", "Player core rebuilt. Wave reset.");
          }
        }
      }
    }
  }

  progressWave(deltaTime) {
    const player = this.player;
    if (!player) {
      return;
    }

    if (this.shardsCollected >= player.data.shardsToWave) {
      this.wave += 1;
      this.shardsCollected = 0;
      player.data.shardsToWave += 2;
      flashLog(this, "Wave", `Wave ${this.wave} started. Seekers are faster now.`);
      for (let index = 0; index < 2 + this.wave; index += 1) {
        spawnSeeker(this);
      }
    }

    this.spawnCooldown -= deltaTime;
    if (this.spawnCooldown <= 0) {
      this.spawnCooldown = Math.max(0.4, 1.4 - this.wave * 0.08);
      spawnSeeker(this);
    }
  }
}
