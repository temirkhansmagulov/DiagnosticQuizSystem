'use strict';
/**
 * Tiny JSON-file persistence. Each collection lives in var/<name>.json and is
 * written atomically (write temp file, then rename). Good enough for a demo /
 * single-server deployment; swap for a real database later — the rest of the
 * code only uses all()/get()/insert()/update()/remove().
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Collection {
  constructor(dir, name) {
    this.file = path.join(dir, `${name}.json`);
    this.items = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
  }
  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.items, null, 1));
    fs.renameSync(tmp, this.file);
  }
  all(filter) { return filter ? this.items.filter(filter) : this.items.slice(); }
  get(id) { return this.items.find((x) => x.id === id) || null; }
  insert(obj) {
    const item = { id: obj.id || crypto.randomBytes(6).toString('hex'), ...obj };
    this.items.push(item);
    this.save();
    return item;
  }
  update(id, patch) {
    const item = this.get(id);
    if (!item) return null;
    Object.assign(item, typeof patch === 'function' ? patch(item) || {} : patch);
    this.save();
    return item;
  }
  remove(id) {
    const n = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    if (this.items.length !== n) this.save();
    return this.items.length !== n;
  }
}

function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    users: new Collection(dir, 'users'),
    quizzes: new Collection(dir, 'quizzes'),
    attempts: new Collection(dir, 'attempts'),
  };
}

module.exports = { openStore, Collection };
