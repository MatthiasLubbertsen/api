// Startup gate: requests wait until migrations have finished.
let ready = Promise.resolve();

export function setReady(promise) {
  ready = promise;
}

export function whenReady() {
  return ready;
}
