import type {
  InterviewRoom,
  ParticipantStatus,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomResponse,
  BatchRoomAction,
  BatchRoomStatusItemResult,
  BatchRoomStatusResponse,
} from '../types';
import { isBatchTransitionAllowed } from '../types';

const STORAGE_KEY = 'code_interview_rooms';

const mockRooms: InterviewRoom[] = [];

const loadFromStorage = (): InterviewRoom[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load rooms from storage:', e);
  }
  return [...mockRooms];
};

const saveToStorage = (rooms: InterviewRoom[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  } catch (e) {
    console.warn('Failed to save rooms to storage:', e);
  }
};

let roomsCache: InterviewRoom[] | null = null;

const getRoomsCache = (): InterviewRoom[] => {
  if (!roomsCache) {
    roomsCache = loadFromStorage();
  }
  return roomsCache;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const generateRoomCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export async function mockCreateRoom(data: CreateRoomRequest): Promise<CreateRoomResponse> {
  await delay(500);
  const rooms = getRoomsCache();
  const roomId = 'room-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const roomCode = generateRoomCode();
  const now = new Date().toISOString();

  const newRoom: InterviewRoom = {
    id: roomId,
    roomCode: roomCode,
    title: data.title,
    problemId: data.problemId,
    interviewerId: data.interviewerId,
    candidateId: '',
    status: 'WAITING',
    createdAt: now,
    code: '',
    language: 'javascript',
    chatMessages: [],
  };

  const participant: ParticipantStatus = {
    id: 'participant-' + Date.now(),
    roomId: roomId,
    userId: data.interviewerId,
    userName: data.interviewerName,
    userRole: 'INTERVIEWER',
    isOnline: true,
    lastHeartbeat: now,
    joinedAt: now,
  };

  roomsCache = [newRoom, ...rooms];
  saveToStorage(roomsCache);

  return {
    room: { ...newRoom },
    participant: { ...participant },
  };
}

export async function mockGetRoomById(roomId: string): Promise<InterviewRoom> {
  await delay(200);
  const rooms = getRoomsCache();
  const room = rooms.find(r => r.id === roomId);
  if (!room) {
    throw new Error('房间不存在');
  }
  return { ...room };
}

export async function mockGetRoomByCode(roomCode: string): Promise<InterviewRoom> {
  await delay(200);
  const rooms = getRoomsCache();
  const room = rooms.find(r => r.roomCode === roomCode);
  if (!room) {
    throw new Error('房间不存在');
  }
  return { ...room };
}

export async function mockGetRoomsByInterviewer(interviewerId: string): Promise<InterviewRoom[]> {
  await delay(300);
  const rooms = getRoomsCache();
  return rooms
    .filter(r => r.interviewerId === interviewerId)
    .map(r => ({ ...r }));
}

export async function mockUpdateRoomStatus(roomId: string, status: string): Promise<InterviewRoom> {
  await delay(300);
  const rooms = getRoomsCache();
  const index = rooms.findIndex(r => r.id === roomId);
  if (index === -1) {
    throw new Error('房间不存在');
  }

  const updatedRoom: InterviewRoom = {
    ...rooms[index],
    status: status as InterviewRoom['status'],
  };

  roomsCache = [...rooms];
  roomsCache[index] = updatedRoom;
  saveToStorage(roomsCache);
  return { ...updatedRoom };
}

/**
 * 批量变更房间状态，逐项处理：成功的条目立即落盘，失败的条目不影响其它条目。
 * 与后端 /interview-rooms/batch-status 的逐项语义保持一致。
 */
export async function mockBatchUpdateRoomStatuses(
  items: { roomId: string; targetStatus: BatchRoomAction }[]
): Promise<BatchRoomStatusResponse> {
  await delay(400);
  const rooms = getRoomsCache();
  const nextRooms = [...rooms];
  const results: BatchRoomStatusItemResult[] = [];

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'WAITING': return '等待中';
      case 'ACTIVE': return '进行中';
      case 'COMPLETED': return '已结束';
      case 'CANCELLED': return '已取消';
      default: return status;
    }
  };

  for (const item of items) {
    const index = nextRooms.findIndex(r => r.id === item.roomId);
    if (index === -1) {
      results.push({ roomId: item.roomId, targetStatus: item.targetStatus, success: false, message: '房间不存在', room: null });
      continue;
    }

    const current = nextRooms[index];
    if (!isBatchTransitionAllowed(current.status, item.targetStatus)) {
      results.push({
        roomId: item.roomId,
        targetStatus: item.targetStatus,
        success: false,
        message: `当前状态「${statusLabel(current.status)}」不支持此操作`,
        room: null,
      });
      continue;
    }

    const updatedRoom: InterviewRoom = { ...current, status: item.targetStatus };
    if (item.targetStatus === 'COMPLETED' || item.targetStatus === 'CANCELLED') {
      if (!updatedRoom.endedAt) {
        updatedRoom.endedAt = new Date().toISOString();
      }
    } else if (item.targetStatus === 'WAITING') {
      updatedRoom.endedAt = undefined;
      updatedRoom.startedAt = undefined;
    }

    nextRooms[index] = updatedRoom;
    results.push({ roomId: item.roomId, targetStatus: item.targetStatus, success: true, message: '操作成功', room: { ...updatedRoom } });
  }

  // 仅在有至少一个成功条目时写回，保证部分成功被保留
  if (results.some(r => r.success)) {
    roomsCache = nextRooms;
    saveToStorage(roomsCache);
  }

  return {
    action: items[0]?.targetStatus ?? 'COMPLETED',
    total: results.length,
    successCount: results.filter(r => r.success).length,
    failedCount: results.filter(r => !r.success).length,
    results,
  };
}

export async function mockGetRoomParticipants(roomId: string): Promise<ParticipantStatus[]> {
  await delay(200);
  const rooms = getRoomsCache();
  const room = rooms.find(r => r.id === roomId);
  if (!room) {
    throw new Error('房间不存在');
  }

  const participants: ParticipantStatus[] = [];
  if (room.interviewerId) {
    participants.push({
      id: 'participant-interviewer-' + room.interviewerId,
      roomId: roomId,
      userId: room.interviewerId,
      userName: '面试官',
      userRole: 'INTERVIEWER',
      isOnline: true,
      lastHeartbeat: new Date().toISOString(),
      joinedAt: room.createdAt,
    });
  }
  if (room.candidateId) {
    participants.push({
      id: 'participant-candidate-' + room.candidateId,
      roomId: roomId,
      userId: room.candidateId,
      userName: '候选人',
      userRole: 'CANDIDATE',
      isOnline: false,
      lastHeartbeat: new Date().toISOString(),
      joinedAt: room.createdAt,
    });
  }

  return participants;
}

export async function mockJoinRoom(roomId: string, data: { candidateName: string; inviteToken: string }): Promise<JoinRoomResponse> {
  await delay(500);
  const rooms = getRoomsCache();
  const index = rooms.findIndex(r => r.id === roomId);
  if (index === -1) {
    throw new Error('房间不存在');
  }

  const candidateId = 'candidate-' + Date.now();
  const now = new Date().toISOString();

  const updatedRoom: InterviewRoom = {
    ...rooms[index],
    candidateId: candidateId,
    status: 'ACTIVE',
    startedAt: now,
  };

  const participant: ParticipantStatus = {
    id: 'participant-' + Date.now(),
    roomId: roomId,
    userId: candidateId,
    userName: data.candidateName,
    userRole: 'CANDIDATE',
    isOnline: true,
    lastHeartbeat: now,
    joinedAt: now,
  };

  roomsCache = [...rooms];
  roomsCache[index] = updatedRoom;
  saveToStorage(roomsCache);

  return {
    participant: { ...participant },
    room: { ...updatedRoom },
    message: '加入成功',
  };
}

export async function mockLeaveRoom(_roomId: string, _userId: string): Promise<void> {
  await delay(200);
}

export async function mockHeartbeat(roomId: string, userId: string): Promise<ParticipantStatus> {
  await delay(100);
  return {
    id: 'participant-' + userId,
    roomId: roomId,
    userId: userId,
    userName: '用户',
    userRole: 'INTERVIEWER',
    isOnline: true,
    lastHeartbeat: new Date().toISOString(),
    joinedAt: new Date().toISOString(),
  };
}

export const resetMockRoomData = () => {
  roomsCache = [...mockRooms];
  saveToStorage(roomsCache);
};
