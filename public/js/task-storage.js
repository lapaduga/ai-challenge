'use strict';

const TASK_STORE_NAME = 'tasks';
const ARCHIVE_STORE_NAME = 'archived_tasks';
const DB_NAME = 'AIChallenge';

class TaskStorage {
  constructor() {
    this.db = null;
    this.ready = this._open();
  }

  _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(TASK_STORE_NAME)) {
          db.createObjectStore(TASK_STORE_NAME, { keyPath: 'taskId' });
        }
        if (!db.objectStoreNames.contains(ARCHIVE_STORE_NAME)) {
          db.createObjectStore(ARCHIVE_STORE_NAME, { keyPath: 'taskId' });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveTask(taskId, data) {
    await this.ready;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(TASK_STORE_NAME, 'readwrite');
        const store = tx.objectStore(TASK_STORE_NAME);
        const req = store.put({ taskId, ...data, updatedAt: Date.now() });
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  async loadTask(taskId) {
    await this.ready;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(TASK_STORE_NAME, 'readonly');
        const store = tx.objectStore(TASK_STORE_NAME);
        const req = store.get(taskId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  async deleteTask(taskId) {
    await this.ready;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(TASK_STORE_NAME, 'readwrite');
        const store = tx.objectStore(TASK_STORE_NAME);
        const req = store.delete(taskId);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  async getActiveTasks() {
    await this.ready;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(TASK_STORE_NAME, 'readonly');
        const store = tx.objectStore(TASK_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  async archiveTask(task) {
    await this.ready;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(ARCHIVE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ARCHIVE_STORE_NAME);
        const req = store.put(task);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  async getArchivedTasks() {
    await this.ready;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(ARCHIVE_STORE_NAME, 'readonly');
        const store = tx.objectStore(ARCHIVE_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  async deleteArchivedTask(taskId) {
    await this.ready;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(ARCHIVE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ARCHIVE_STORE_NAME);
        const req = store.delete(taskId);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }

  async clearArchivedTasks() {
    await this.ready;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(ARCHIVE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ARCHIVE_STORE_NAME);
        const req = store.clear();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }
}

window.TaskStorage = TaskStorage;