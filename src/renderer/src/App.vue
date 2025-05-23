<template>
  <v-app>
    <v-container class="grey lighten-5">
      <v-row no-gutters style="height: 64px">
        <v-col>
          <v-text-field label="IP:PORT" hide-details="auto" @update:model-value="changeIpport" v-model="inputIpport"
            :rules="[ipportRule]"></v-text-field>
        </v-col>
      </v-row>
      <v-row no-gutters class="button-row" v-if="!checkbtn.progress">
        <v-col>
          <v-btn depressed color="blue-grey" raised @click="testHost()">ホストを担当</v-btn>
        </v-col>
        <v-col>
          <v-btn depressed color="blue-grey" raised @click="testClient()">クライアントを担当</v-btn>
        </v-col>
      </v-row>
      <v-row no-gutters class="button-row" v-else>
        <v-col>
          <v-btn depressed color="blue-grey" raised @click="suspend()">中止</v-btn>
        </v-col>
      </v-row>
      <v-row no-gutters>
        <v-col>
          <!-- <div class="network-container">
            <div ref="network" class="network-graph"></div>
          </div> -->
          <NetworkGraph :nodes="nodes" :edges="edges" :options="nwGraphOptions" :current-state="currentState"
            @update:current-state="s => currentState = s" />
        </v-col>
      </v-row>
      <v-row>
        <v-col class="log">
          <transition-group name="log-fade" tag="div">
            <span v-for="(log, index) in logs" :key="index" class="log-entry">
              {{ log }}
            </span>
          </transition-group>
        </v-col>
      </v-row>
    </v-container>
  </v-app>
</template>

<script setup>
import { ref, computed, onBeforeUnmount, reactive, nextTick, onMounted } from 'vue';
import NetworkGraph from './components/NetworkGraph.vue';
import { GraphState, Step, EdgeColors } from './constants.js';

const nodes = [
  { id: 'H', label: 'ホスト', x: -100, y: 50, fixed: true, color: '#a79065' },
  { id: 'C', label: 'クライアント', x: 200, y: 50, fixed: true, color: '#a79065' },
  { id: 'AP', label: 'オートパンチ', x: 50, y: -100, fixed: true, color: '#158f60' },
  { id: 'G', label: 'Google', x: -200, y: -100, fixed: true, color: '#4285f4' },
];

const _edges = {
  [Step.Noop]: [],
  [Step.Host2AP]: [{
    id: Step.Host2AP,
    from: 'H',
    to: 'AP',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  }],
  [Step.Client2AP]: [{
    id: Step.Client2AP,
    from: 'C',
    to: 'AP',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  }],
  [Step.AP2User]: [{
    id: 'AP2H',
    from: 'AP',
    to: 'H',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  }, {
    id: 'AP2C',
    from: 'AP',
    to: 'C',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  }],
  [Step.Host2Stun]: [{
    id: Step.Host2Stun,
    from: 'H',
    to: 'G',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  }],
  [Step.Stun2Host]: [{
    id: Step.Stun2Host,
    from: 'G',
    to: 'H',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  }],
  [Step.Holepunching]: [{
    id: 'H2C',
    from: 'H',
    to: 'C',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    smooth: { type: 'curvedCW', roundness: 0.1 },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  },
  {
    id: 'C2H',
    from: 'C',
    to: 'H',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    smooth: { type: 'curvedCW', roundness: 0.1 },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  }],
  [Step.FW4H]: [{
    id: 'FW4H',
    from: 'H',
    to: 'H',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    smooth: { type: 'curvedCW', roundness: 0.1 },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  }],
  [Step.FW4C]: [{
    id: 'FW4C',
    from: 'C',
    to: 'C',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    smooth: { type: 'curvedCW', roundness: 0.1 },
    dashes: [5, 5],
    color: { color: EdgeColors.Normal }
  }]
};

const nwGraphOptions = {
  edges: { width: 2 },
  nodes: { shape: 'dot', font: { size: 13, color: 'gold' } },
  physics: false,
};

const StepDelay = 3000;

const inputIpport = ref('');
const checkbtn = reactive({ progress: false });
const edges = computed(() => _edges[currentStep.value]);
const logs = reactive(['ホストとクライアントは検証したいユーザーのIP:PORTを入力して、担当のボタンを押してください。']);

let currentStep = ref(Step.Noop);
let currentState = ref(GraphState.Ping);


const ipportRule = computed(() => {
  const pattern =
    /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]):(\d+)$/;
  return pattern.test(inputIpport.value)
    ? true
    : 'Input style [xxx.xxx.xxx.xxx:port]';
});

function checkLog(success) {
  if (success) {
    logs[logs.length - 1] = logs.last().replace(']', '] ✅ ');
  } else {
    logs[logs.length - 1] = logs.last().replace(']', '] ❌ ');
    currentState.value = GraphState.Error;
  }
}

async function testHost() {
  checkbtn.progress = true;
  logs.splice(0, logs.length);

  changeStep(Step.FW4H, GraphState.Pooling);
  logs.push('[1/6] ファイアウォールのルールを取得します。');
  if (await waitIpc('checkFW')) return;

  changeStep(Step.Host2AP, GraphState.Pooling);
  logs.push('[2/6] オートパンチにホスト情報を送信。クライアントからのアクセスを待機中。3分後にタイムアウトします。');
  if (await waitIpc('HtoAP')) return;

  changeStep(Step.AP2User, GraphState.Ping);
  logs.push('[3/6] クライアントがオートパンチにアクセスし、お互いの情報を取得しました。');
  logs.push(`・クライアントの情報：${inputIpport.value}`);
  await delay(StepDelay);

  window.ipcRenderer.send('toSTUN');
  changeStep(Step.Host2Stun, GraphState.Ping);
  logs.push('[4/6] Googleにアクセスして外部ポートの変化を確認しました。以下の外部ポートがクライアントから伝えられたものと違う場合はNATが原因でホストが不可能です。');
  logs.push(`・自身の外部ポート：${inputIpport.value}`);
  await delay(StepDelay);
  changeStep(Step.Stun2Host, GraphState.Ping);
  await delay(StepDelay);

  window.ipcRenderer.send('toClient');
  changeStep(Step.Holepunching, GraphState.Pooling);
  logs.push('[5/6] クライアントとUDPホールパンチングを実施します。しばらくお待ち下さい。');
  await delay(StepDelay);

  logs.push('[6/6] クライアントと通信に成功しました。ホスト可能です。');
}

async function waitIpc(eventName, ...args) {
  window.ipcRenderer.send(eventName, ...args);
  const { result, msg } = await ipcPromisify(eventName);
  await delay(StepDelay);
  checkLog(result);
  logs.push(msg);
  return result;
}

async function testClient() {
  checkbtn.progress = true;
  logs.splice(0, logs.length);

  changeStep(Step.FW4H, GraphState.Pooling);
  logs.push('[1/5] ファイアウォールのルールを取得します。');
  const { result, msg } = await ipcPromisify('checkFW');
  await delay(StepDelay);
  checkLog(result);
  logs.push(msg);
  await delay(StepDelay);

  window.ipcRenderer.send('toAP', inputIpport.value);
  changeStep(Step.Client2AP, GraphState.Pooling);
  logs.push('[2/5] オートパンチにホストへ凸りたいことを伝えています。');
  await delay(StepDelay);

  changeStep(Step.AP2User, GraphState.Ping);
  logs.push('[3/5] オートパンチからホストの情報を取得しました。この情報をホスト担当に提供してください。');
  logs.push(`・ホストの情報：${inputIpport.value}`);
  await delay(StepDelay);

  changeStep(Step.Holepunching, GraphState.Pooling);
  window.ipcRenderer.send('holepunching', inputIpport.value);
  logs.push('[4/5] ホストとUDPホールパンチングを実施します。しばらくお待ち下さい。');
  await delay(StepDelay);

  logs.push('[5/5] ホストと通信に成功しました。検証ご苦労さまでした。');
}

function ipcPromisify(eventName, ...args) {
  return new Promise((resolve, reject) => {
    const handler = (event, ...result) => {
      window.ipcRenderer.removeAllListeners();
      resolve(...result);
    };
    window.ipcRenderer.on(eventName, handler);
    window.ipcRenderer.send(eventName, ...args);
  });
}

function waitCheckFW() { return ipcPromisify('checkFW'); }



function suspend() {
  checkbtn.progress = false;
  changeStep(Step.Noop, GraphState.Idle);
  window.ipcRenderer.send('suspend');
}

onBeforeUnmount(() => {
  // window.ipcRenderer.removeAllListeners('result-ping');
});


onMounted(() => { });

function changeStep(step, state) {
  currentStep.value = step;
  currentState.value = state;
}

function changeIpport() {
  nextTick(() => {
    inputIpport.value = inputIpport.value.trim();
  });
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); };

Array.prototype.last = function () {
  if (this.length === 0) {
    return null;
  }
  return this[this.length - 1];
};

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

.info-text {
  position: absolute;
  bottom: 10px;
  left: 10px;
  font-size: 18px;
  color: #333;
  background: rgba(255, 255, 255, 0.8);
  padding: 4px 8px;
  border-radius: 4px;
}

.button-row {
  height: 48px;
  margin: 16px;
  text-align: center;
}

.log {
  position: relative;
  width: 100vw;
  height: 40vh;
  display: block;
  overflow-y: scroll;
  background: rgba(255, 255, 255, 0.05);
}

.log-entry {
  display: block;
  font-size: 13px;
}

/* アニメーション */
.log-fade-enter-active,
.log-fade-leave-active {
  transition: all 0.3s ease;
}

.log-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.log-fade-enter-to {
  opacity: 1;
  transform: translateY(0);
}
</style>
