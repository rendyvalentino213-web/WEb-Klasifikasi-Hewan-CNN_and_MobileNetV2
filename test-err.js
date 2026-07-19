import * as tf from '@tensorflow/tfjs';
import fs from 'fs';

const layersJson = {
  modelTopology: {
    class_name: "Sequential",
    config: {
      layers: []
    }
  },
  weightsManifest: []
};

async function run() {
  try {
    const weightSpecs = [];
    const weightData = new ArrayBuffer(0);
    await tf.loadGraphModel(tf.io.fromMemory(layersJson, weightSpecs, weightData));
  } catch (e) {
    console.log("loadGraphModel on LayersModel:", e.message);
  }
}
run();
