// nav.js — grid A* navigation with obstacle inflation and path smoothing.
export class NavGrid {
  constructor(world, cell = 0.2) {
    this.cell = cell;
    this.minX = -3.9; this.maxX = 3.9; this.minZ = -2.9; this.maxZ = 2.9;
    this.w = Math.ceil((this.maxX - this.minX) / cell);
    this.h = Math.ceil((this.maxZ - this.minZ) / cell);
    this.blocked = new Uint8Array(this.w * this.h);
    const inflate = 0.16; // body radius
    for (const ob of world.obstacles) {
      const x0 = Math.max(0, Math.floor((ob.minX - inflate - this.minX) / cell));
      const x1 = Math.min(this.w - 1, Math.ceil((ob.maxX + inflate - this.minX) / cell));
      const z0 = Math.max(0, Math.floor((ob.minZ - inflate - this.minZ) / cell));
      const z1 = Math.min(this.h - 1, Math.ceil((ob.maxZ + inflate - this.minZ) / cell));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.blocked[z * this.w + x] = 1;
    }
  }
  toCell(x, z) {
    return [
      Math.max(0, Math.min(this.w - 1, Math.round((x - this.minX) / this.cell))),
      Math.max(0, Math.min(this.h - 1, Math.round((z - this.minZ) / this.cell)))
    ];
  }
  toWorld(cx, cz) { return [this.minX + cx * this.cell, this.minZ + cz * this.cell]; }
  isFree(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h && !this.blocked[cz * this.w + cx]; }

  nearestFree(cx, cz) {
    if (this.isFree(cx, cz)) return [cx, cz];
    for (let r = 1; r < 14; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.isFree(cx + dx, cz + dz)) return [cx + dx, cz + dz];
        }
    return [cx, cz];
  }

  findPath(sx, sz, tx, tz) {
    let [scx, scz] = this.nearestFree(...this.toCell(sx, sz));
    let [tcx, tcz] = this.nearestFree(...this.toCell(tx, tz));
    const W = this.w, key = (x, z) => z * W + x;
    const open = [[0, scx, scz]];
    const g = new Map([[key(scx, scz), 0]]);
    const came = new Map();
    const h = (x, z) => Math.hypot(x - tcx, z - tcz);
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let found = false;
    let iter = 0;
    while (open.length && iter++ < 6000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cx, cz] = open.splice(bi, 1)[0];
      if (cx === tcx && cz === tcz) { found = true; break; }
      const gc = g.get(key(cx, cz));
      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.isFree(nx, nz)) continue;
        if (dx && dz && (!this.isFree(cx + dx, cz) || !this.isFree(cx, cz + dz))) continue; // no corner cutting
        const ng = gc + cost;
        const k = key(nx, nz);
        if (ng < (g.get(k) ?? Infinity)) {
          g.set(k, ng); came.set(k, key(cx, cz));
          open.push([ng + h(nx, nz), nx, nz]);
        }
      }
    }
    if (!found) return [[tx, tz]];
    // reconstruct
    const cells = [];
    let k = key(tcx, tcz);
    while (k !== undefined && k !== key(scx, scz)) {
      cells.push([k % W, Math.floor(k / W)]);
      k = came.get(k);
    }
    cells.reverse();
    // line-of-sight smoothing
    const pts = cells.map(([cx, cz]) => this.toWorld(cx, cz));
    const out = [];
    let anchor = [sx, sz];
    for (let i = 0; i < pts.length; i++) {
      const next = pts[i + 1];
      if (!next || !this._los(anchor[0], anchor[1], next[0], next[1])) {
        out.push(pts[i]); anchor = pts[i];
      }
    }
    out.push([tx, tz]);
    return out;
  }
  _los(x0, z0, x1, z1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (this.cell * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const [cx, cz] = this.toCell(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (!this.isFree(cx, cz)) return false;
    }
    return true;
  }
}
