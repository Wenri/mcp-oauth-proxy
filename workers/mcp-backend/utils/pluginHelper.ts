// Stub for CF Workers environment — no plugin instance available.

let pluginInstance: any = null;

export function setPluginInstance(instance: any) {
  pluginInstance = instance;
}

export function getPluginInstance(): any {
  return pluginInstance;
}
