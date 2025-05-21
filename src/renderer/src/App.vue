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
        <v-col class="network-container">
          <div ref="network" class="network-graph"></div>
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
import { Network } from 'vis-network';

const State = {
  Idle: 'Idle',
  Ping: 'Ping',
  Pooling: 'Pooling',
  Error: 'Error',
};

const Step = {
  Noop: 'Noop',
  FW4H: 'FW4H',
  FW4C: 'FW4C',
  Host2AP: 'Host2AP',
  Client2AP: 'Client2AP',
  AP2User: 'AP2User',
  Host2Stun: 'Host2Stun',
  Stun2Host: 'Stun2Host',
  Holepunching: 'Holepunching',
};

const Colors = {
  Normal: '#1abc9c',
  Error: 'red',
  Transparent: 'rgba(0,0,0,0)',
};

const StepDelay = 3000;

const inputIpport = ref('');
const checkbtn = reactive({ progress: false });
const network = ref(null);
const log = computed(() => logs.join('\n'));
const logs = reactive(['ホストとクライアントは検証したいユーザーのIP:PORTを入力して、担当のボタンを押してください。']);

const ipportRule = computed(() => {
  const pattern =
    /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]):(\d+)$/;
  return pattern.test(inputIpport.value)
    ? true
    : 'Input style [xxx.xxx.xxx.xxx:port]';
});

const submitReady = computed(() => ipportRule.value === true);

function changeIpport() {
  nextTick(() => {
    inputIpport.value = inputIpport.value.trim();
  });
}

function checkLog(success) {
  if (success) {
    logs[logs.length - 1] = logs.last().replace(']', '] ✅ ');
  } else {
    logs[logs.length - 1] = logs.last().replace(']', '] ❌ ');
  }
}

async function testHost() {
  checkbtn.progress = true;
  logs.splice(0, logs.length);

  window.ipcRenderer.send('checkFW');
  changeStep(Step.FW4H, State.Pooling);
  logs.push('[1/6] ファイアウォールのルールを取得。');
  await delay(StepDelay);
  checkLog(true);
  logs.push('・OK');
  await delay(StepDelay);

  window.ipcRenderer.send('toAP', inputIpport.value);
  changeStep(Step.Host2AP, State.Pooling);
  logs.push('[2/6] オートパンチにホスト情報を送信。クライアントからのアクセスを待機中。');
  await delay(StepDelay);
  checkLog(false);

  changeStep(Step.AP2User, State.Ping);
  logs.push('[3/6] クライアントがオートパンチにアクセスし、お互いの情報を取得しました。');
  logs.push(`・クライアントの情報：${inputIpport.value}`);
  await delay(StepDelay);

  window.ipcRenderer.send('toSTUN');
  changeStep(Step.Host2Stun, State.Ping);
  logs.push('[4/6] Googleにアクセスして外部ポートの変化を確認しました。以下の外部ポートがクライアントから伝えられたものと違う場合はNATが原因でホストが不可能です。');
  logs.push(`・自身の外部ポート：${inputIpport.value}`);
  await delay(StepDelay);
  changeStep(Step.Stun2Host, State.Ping);
  await delay(StepDelay);

  window.ipcRenderer.send('toClient');
  changeStep(Step.Holepunching, State.Pooling);
  logs.push('[5/6] クライアントとUDPホールパンチングを実施します。しばらくお待ち下さい。');
  await delay(StepDelay);

  logs.push('[6/6] クライアントと通信に成功しました。ホスト可能です。');
}

async function testClient() {
  checkbtn.progress = true;
  logs.splice(0, logs.length);

  window.ipcRenderer.send('checkFW');
  changeStep(Step.FW4C, State.Pooling);
  logs.push('[1/5] ファイアウォールのルールを取得します。');
  logs.push('OK');
  await delay(StepDelay);

  window.ipcRenderer.send('toAP', inputIpport.value);
  changeStep(Step.Client2AP, State.Pooling);
  logs.push('[2/5] オートパンチにホストへ凸りたいことを伝えています。');
  await delay(StepDelay);

  changeStep(Step.AP2User, State.Ping);
  logs.push('[3/5] オートパンチからホストの情報を取得しました。この情報をホスト担当に提供してください。');
  logs.push(`・ホストの情報：${inputIpport.value}`);
  await delay(StepDelay);

  changeStep(Step.Holepunching, State.Pooling);
  window.ipcRenderer.send('holepunching', inputIpport.value);
  logs.push('[4/5] ホストとUDPホールパンチングを実施します。しばらくお待ち下さい。');
  await delay(StepDelay);

  logs.push('[5/5] ホストと通信に成功しました。検証ご苦労さまでした。');
}

window.ipcRenderer.on('checkFW', (event, { result, msg }) => {
  console.log(result, msg);
  alert(msg);
});


function suspend() {
  checkbtn.progress = false;
  currentState = State.Idle;
  currentStep = Step.Noop;
  window.ipcRenderer.send('suspend');
}

function ping(ipport, isAP) {
  window.ipcRenderer.on('result-ping', (event, arg) => {
    console.log(event, arg);
    if (arg === 'end') {
      window.ipcRenderer.removeAllListeners('result-ping');
      checkbtn.progress = false;
    } else {
      option.series[0].data.push(parseFloat(arg) || 100);
    }
  });
  if (isAP) {
    window.ipcRenderer.send('do-ping-ap', ipport);
  } else {
    window.ipcRenderer.send('do-ping', ipport);
  }
}

onBeforeUnmount(() => {
  window.ipcRenderer.removeAllListeners('result-ping');
});

const nodes = [
  { id: 'H', label: 'ホスト', x: -100, y: 50, fixed: true, color: '#a79065' },
  { id: 'C', label: 'クライアント', x: 200, y: 50, fixed: true, color: '#a79065' },
  { id: 'AP', label: 'オートパンチ', x: 50, y: -100, fixed: true, color: '#158f60' },
  { id: 'G', label: 'Google', x: -200, y: -100, fixed: true, color: '#4285f4' },
];

const edges = {
  [Step.Noop]: [],
  [Step.Host2AP]: [{
    id: Step.Host2AP,
    from: 'H',
    to: 'AP',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: Colors.Normal }
  }],
  [Step.Client2AP]: [{
    id: Step.Client2AP,
    from: 'C',
    to: 'AP',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: Colors.Normal }
  }],
  [Step.AP2User]: [{
    id: 'AP2H',
    from: 'AP',
    to: 'H',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: Colors.Normal }
  }, {
    id: 'AP2C',
    from: 'AP',
    to: 'C',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: Colors.Normal }
  }],
  [Step.Host2Stun]: [{
    id: Step.Host2Stun,
    from: 'H',
    to: 'G',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: Colors.Normal }
  }],
  [Step.Stun2Host]: [{
    id: Step.Stun2Host,
    from: 'G',
    to: 'H',
    arrows: {
      to: { enabled: true, scaleFactor: 0.5 },
    },
    dashes: [5, 5],
    color: { color: Colors.Normal }
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
    color: { color: Colors.Normal }
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
    color: { color: Colors.Normal }
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
    color: { color: Colors.Normal }
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
    color: { color: Colors.Normal }
  }]
};

const AnimFPS = 16;
const OneSec = parseInt(1000 / AnimFPS);
let networkInstance;
let currentStep = Step.Noop;
let stepIdx = 0;
let currentState = State.Ping;
const stepList = Object.values(Step);
let animIdx = 0;

onMounted(() => {
  const container = network.value;
  const data = { nodes, edges: edges[Step.Noop] };
  const options = {
    edges: { width: 2 },
    nodes: { shape: 'dot', font: { size: 13, color: 'gold' } },
    physics: false,
  };
  networkInstance = new Network(container, data, options);

  setInterval(() => {
    animIdx++;
    if (currentState === State.Idle) {
      edges[currentStep].forEach(idleAnim);
    } else if (currentState === State.Ping) {
      edges[currentStep].forEach(edge => pingAnim(edge, true));
    } else if (currentState === State.Pooling) {
      edges[currentStep].forEach(edge => pingAnim(edge, false));
    } else if (currentState === State.Error) {
      edges[currentStep].forEach(errorAnim);
    } else {
      console.warn('Unknown state:', currentState);
    }

    function idleAnim(edge) {
      edge.color = { color: Colors.Transparent };
    }

    function errorAnim(edge) {
      edge.color = { color: (animIdx % OneSec) > OneSec / 2 ? Colors.Error : Colors.Transparent };
    }

    function pingAnim(edge, once) {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);
      if (!(fromNode && toNode)) return;
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const oneStep = Math.floor(distance / 3 * 2) + (fromNode === toNode ? 20 : 0);
      if (once && (animIdx >= (oneStep + OneSec / 3))) {
        return currentState = State.Idle;
      } else if (!once && animIdx >= (oneStep + OneSec / 3)) {
        animIdx = 0;
      }
      const to = ((animIdx >= oneStep) && animIdx < (oneStep + OneSec / 3)) ? 0 : oneStep - (animIdx % oneStep);
      edge.endPointOffset = {
        from: 0,
        to
      };
    }

    networkInstance.setData({ nodes, edges: edges[currentStep] });

  }, AnimFPS);


  // TODO これは消す
  // setInterval(() => {
  //   animIdx = 0;
  //   currentState = State.Pooling;
  //   stepIdx = (stepIdx + 1) % stepList.length;
  //   const step = stepList[stepIdx];
  //   networkInstance.setData({ nodes, edges: edges[step] });
  // }, 7000);

});

function changeStep(step, state) {
  animIdx = 0;
  currentStep = step;
  currentState = state;
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); };

Array.prototype.last = function () {
  if (this.length === 0) {
    return null;
  }
  return this[this.length - 1];
};

</script>

<style>
.network-container {
  position: relative;
  width: 100vw;
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
