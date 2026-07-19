const fs = require('fs');

function fixKerasV3Topology(topology) {
  if (!topology || !topology.config || !topology.config.layers) return topology;
  
  topology.config.layers.forEach(layer => {
    if (layer.class_name === 'InputLayer' && layer.config) {
      if (layer.config.batch_shape && !layer.config.batchInputShape) {
        layer.config.batchInputShape = layer.config.batch_shape;
      }
      if (layer.config.shape && !layer.config.batchInputShape) {
        layer.config.batchInputShape = [null, ...layer.config.shape];
      }
    }
    
    if (layer.inbound_nodes && layer.inbound_nodes.length > 0) {
      // Check if it's Keras v3 format
      if (typeof layer.inbound_nodes[0] === 'object' && !Array.isArray(layer.inbound_nodes[0])) {
        const newInboundNodes = [];
        layer.inbound_nodes.forEach(node => {
          if (node.args) {
            const nodeData = [];
            node.args.forEach(arg => {
              if (arg.class_name === '__keras_tensor__' && arg.config && arg.config.keras_history) {
                const history = arg.config.keras_history;
                // history is [layer_name, node_index, tensor_index]
                nodeData.push([history[0], history[1], history[2], node.kwargs || {}]);
              } else if (Array.isArray(arg)) {
                // Sometimes it's a list of tensors (e.g. Concatenate)
                arg.forEach(subArg => {
                  if (subArg.class_name === '__keras_tensor__' && subArg.config && subArg.config.keras_history) {
                    const history = subArg.config.keras_history;
                    nodeData.push([history[0], history[1], history[2], node.kwargs || {}]);
                  }
                });
              }
            });
            if (nodeData.length > 0) {
              newInboundNodes.push(nodeData);
            }
          }
        });
        layer.inbound_nodes = newInboundNodes;
      }
    }
  });
  
  return topology;
}

console.log("Fix script ready");
