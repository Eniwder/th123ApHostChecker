export const GraphState = {
  Idle: 'Idle',
  Ping: 'Ping',
  Pooling: 'Pooling',
  Error: 'Error',
};

export const Step = {
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

export const EdgeColors = {
  Normal: '#1abc9c',
  Error: 'red',
  Transparent: 'rgba(0,0,0,0)',
};
