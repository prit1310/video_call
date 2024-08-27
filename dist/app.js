// Attach ripple effect to buttons (Material Design Components)
mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

// Default configuration - Change these if you have a different STUN or TURN server.
const configuration = {
  iceServers: [
    {
      urls: [
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global variables
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;

function init() {
  document.querySelector('#cameraBtn').addEventListener('click', openUserMedia);
  document.querySelector('#hangupBtn').addEventListener('click', hangUp);
  document.querySelector('#createBtn').addEventListener('click', createRoom);
  document.querySelector('#joinBtn').addEventListener('click', joinRoom);
  roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));
}

// Function to create a new room
async function createRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;
  const db = firebase.firestore();

  console.log('Create PeerConnection with configuration: ', configuration);
  peerConnection = new RTCPeerConnection(configuration);
  registerPeerConnectionListeners();

  // Add local stream tracks to peer connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  } else {
    console.error('Local stream is undefined');
    return;
  }

  // Create an offer and set it as local description
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const roomWithOffer = {
    offer: {
      type: offer.type,
      sdp: offer.sdp,
    },
  };

  const roomRef = await db.collection('rooms').add(roomWithOffer);
  roomId = roomRef.id;
  document.querySelector('#currentRoom').innerText = `Current room is ${roomId} - You are the caller!`;

  // Listen for remote session description and ICE candidates
  roomRef.onSnapshot(async snapshot => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data?.answer) {
      const answer = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(answer);
    }
  });

  collectIceCandidates(roomRef, peerConnection, 'callerCandidates', 'calleeCandidates');
}

// Function to join an existing room
function joinRoom() {
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#joinBtn').disabled = true;

  document.querySelector('#confirmJoinBtn').addEventListener('click', async () => {
    roomId = document.querySelector('#room-id').value;
    document.querySelector('#currentRoom').innerText = `Current room is ${roomId} - You are the callee!`;
    await joinRoomById(roomId);
  }, { once: true });

  roomDialog.open();
}

// Function to handle joining a room by ID
async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection('rooms').doc(roomId);
  const roomSnapshot = await roomRef.get();

  if (roomSnapshot.exists) {
    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();

    // Add local stream tracks to peer connection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    } else {
      console.error('Local stream is undefined');
      return;
    }

    // Get the offer from the room, set it as remote description, and create an answer
    const offer = roomSnapshot.data()?.offer;
    if (offer) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    } else {
      console.error('Offer is undefined');
      return;
    }

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    const roomWithAnswer = {
      answer: {
        type: answer.type,
        sdp: answer.sdp,
      },
    };
    await roomRef.update(roomWithAnswer);

    collectIceCandidates(roomRef, peerConnection, 'calleeCandidates', 'callerCandidates');
  } else {
    console.error('Room does not exist');
  }
}

// Function to collect and handle ICE candidates
async function collectIceCandidates(roomRef, peerConnection, localName, remoteName) {
  const candidatesCollection = roomRef.collection(localName);

  peerConnection.addEventListener('icecandidate', event => {
    if (event.candidate) {
      candidatesCollection.add(event.candidate.toJSON());
    }
  });

  roomRef.collection(remoteName).onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        peerConnection.addIceCandidate(candidate);
      }
    });
  });
}

// Function to open user media (camera and microphone)
async function openUserMedia() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.querySelector('#localVideo').srcObject = stream;
    localStream = stream;
    remoteStream = new MediaStream();
    document.querySelector('#remoteVideo').srcObject = remoteStream;

    document.querySelector('#cameraBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = false;
    document.querySelector('#createBtn').disabled = false;
    document.querySelector('#hangupBtn').disabled = false;
  } catch (error) {
    console.error('Error accessing user media:', error);
  }
}

// Function to hang up the call and close connections
async function hangUp() {
  const tracks = document.querySelector('#localVideo').srcObject?.getTracks();
  if (tracks) {
    tracks.forEach(track => track.stop());
  }

  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector('#localVideo').srcObject = null;
  document.querySelector('#remoteVideo').srcObject = null;
  document.querySelector('#cameraBtn').disabled = false;
  document.querySelector('#joinBtn').disabled = true;
  document.querySelector('#createBtn').disabled = true;
  document.querySelector('#hangupBtn').disabled = true;
  document.querySelector('#currentRoom').innerText = '';

  // Delete room on hangup
  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection('rooms').doc(roomId);
    const calleeCandidates = await roomRef.collection('calleeCandidates').get();
    calleeCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    const callerCandidates = await roomRef.collection('callerCandidates').get();
    callerCandidates.forEach(async candidate => {
      await candidate.ref.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

// Function to register peer connection listeners for debugging
function registerPeerConnectionListeners() {
  peerConnection.addEventListener('icegatheringstatechange', () => {
    console.log(`ICE gathering state changed: ${peerConnection.iceGatheringState}`);
  });

  peerConnection.addEventListener('connectionstatechange', () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener('signalingstatechange', () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener('iceconnectionstatechange', () => {
    console.log(`ICE connection state change: ${peerConnection.iceConnectionState}`);
  });
}

// Initialize the application
init();
