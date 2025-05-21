<template>
  <div class="network-container">
    <div ref="network" class="network-graph"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, defineEmits } from 'vue';
import { Network } from 'vis-network';
import { GraphState, EdgeColors } from '../constants.js';

const network = ref(null);

const props = defineProps({
  nodes: Array,
  edges: Array,
  options: Object,
  currentState: String,
});

const emit = defineEmits(['update:currentState']);

const AnimFPS = 16;
const OneSec = parseInt(1000 / AnimFPS);
let networkInstance;
let animIdx = 0;
let animTimer = null;

onBeforeUnmount(() => {
  if (networkInstance) {
    networkInstance.destroy();
  }
  if (animTimer) {
    clearInterval(animTimer);
  }
});

onMounted(() => {
  networkInstance = new Network(network.value, { nodes: props.nodes, edges: props.edges }, props.options);

  animTimer = setInterval(() => {
    animIdx++;
    if (props.currentState === GraphState.Idle) {
      props.edges.forEach(idleAnim);
    } else if (props.currentState === GraphState.Ping) {
      props.edges.forEach(edge => pingAnim(edge, true));
    } else if (props.currentState === GraphState.Pooling) {
      props.edges.forEach(edge => pingAnim(edge, false));
    } else if (props.currentState === GraphState.Error) {
      props.edges.forEach(errorAnim);
    } else {
      console.warn('Unknown state:', props.currentState);
    }
    networkInstance.setData({ nodes: props.nodes, edges: props.edges, options: props.options });
  }, AnimFPS);

});

function idleAnim(edge) {
  edge.color = { color: EdgeColors.Transparent };
}

function errorAnim(edge) {
  edge.color = { color: (animIdx % OneSec) > OneSec / 2 ? EdgeColors.Error : EdgeColors.Transparent };
}

function pingAnim(edge, once) {
  const fromNode = props.nodes.find(n => n.id === edge.from);
  const toNode = props.nodes.find(n => n.id === edge.to);
  if (!(fromNode && toNode)) return;
  const dx = toNode.x - fromNode.x;
  const dy = toNode.y - fromNode.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const oneStep = Math.floor(distance / 3 * 2) + (fromNode === toNode ? 20 : 0);
  if (once && (animIdx >= (oneStep + OneSec / 3))) {
    emit('update:currentState', GraphState.Idle);
  } else if (!once && animIdx >= (oneStep + OneSec / 3)) {
    animIdx = 0;
  }
  const to = ((animIdx >= oneStep) && animIdx < (oneStep + OneSec / 3)) ? 0 : oneStep - (animIdx % oneStep);
  edge.endPointOffset = {
    from: 0,
    to
  };
}


watch(
  () => props.currentState,
  () => { animIdx = 0; }
);
</script>

<style scoped>
.network-container {
  position: relative;
  width: 100%;
  height: 40vh;
}

.network-graph {
  width: 100%;
  height: 100%;
  border: 1px solid #ccc;
}
</style>
