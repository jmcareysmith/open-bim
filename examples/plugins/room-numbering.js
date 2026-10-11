// Open-BIM example plugin: renumber rooms on the active level in reading order
// (rows top to bottom, left to right), prefixed with the level's index: 001, 002… / 101, 102….
// Load it from the Console: Load plugin… → this file.

export default {
  name: "Room numbering",
  activate(api) {
    api.addCommand({
      id: "renumber-rooms",
      label: "Renumber rooms",
      run() {
        const { core } = api;
        const level = api.activeLevel();
        if (!level) return api.status("Open a plan first.");
        const index = core.levels(api.doc).findIndex((l) => l.id === level.id);
        const rooms = core.rooms(api.doc).filter((r) => r.params.levelId === level.id);
        // Rows 1.5 m tall, read top to bottom, then left to right within a row.
        const row = (r) => Math.round(-r.params.point.y / 1500);
        rooms.sort((a, b) => row(a) - row(b) || a.params.point.x - b.params.point.x);
        api.transact("Renumber rooms", (tx) => {
          rooms.forEach((r, i) => tx.update(r.id, { number: `${index}${String(i + 1).padStart(2, "0")}` }));
        });
        api.status(`Renumbered ${rooms.length} room(s) on ${level.name}.`);
      },
    });
  },
};
