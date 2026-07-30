function run() {
  const Photos = Application('Photos');
  const items = Photos.mediaItems;
  const ids = items.id();
  const locs = items.location();
  const dates = items.date();
  const names = items.filename();
  const favs = items.favorite();
  const ws = items.width();
  const hs = items.height();
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const loc = locs[i];
    if (!loc || loc.length !== 2 || loc[0] === null || loc[1] === null) continue;
    out.push({
      id: ids[i],
      lat: loc[0],
      lon: loc[1],
      ts: dates[i] ? Math.floor(dates[i].getTime() / 1000) : null,
      name: names[i],
      fav: favs[i],
      w: ws[i],
      h: hs[i],
    });
  }
  return JSON.stringify(out);
}
