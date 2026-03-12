export async function loadJson(relativePath) {
  const response = await fetch(relativePath);
  if (!response.ok) {
    throw new Error(`Failed to load asset: ${relativePath}`);
  }
  return response.json();
}

export async function loadGameContent() {
  const [playerPrefab, seekerPrefab, level] = await Promise.all([
    loadJson("./assets/prefabs/player.json"),
    loadJson("./assets/prefabs/seeker.json"),
    loadJson("./assets/levels/demo-level.json"),
  ]);

  return {
    prefabs: {
      player: playerPrefab,
      seeker: seekerPrefab,
    },
    levels: {
      demo: level,
    },
  };
}
