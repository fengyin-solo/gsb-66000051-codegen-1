import { request } from './api';
import type { CreateRoomRequest, InterviewRoom, ParticipantStatus, JoinRoomResponse, CreateRoomResponse, BatchRoomResultItem, BatchRoomAction } from '../types';
import {
  mockCreateRoom,
  mockGetRoomById,
  mockGetRoomByCode,
  mockGetRoomsByInterviewer,
  mockUpdateRoomStatus,
  mockGetRoomParticipants,
  mockJoinRoom,
  mockLeaveRoom,
  mockHeartbeat,
} from './mockInterviewRoomService';
import { isUsingMockData, setUseMockFallback } from './problemService';

const handleApiError = (error: any): boolean => {
  if (error.message.includes('Failed to fetch') ||
      error.message.includes('NetworkError') ||
      error.message.includes('ECONNREFUSED') ||
      error.status === 0) {
    setUseMockFallback(true);
    return true;
  }
  return false;
};

export async function createRoom(data: CreateRoomRequest): Promise<CreateRoomResponse> {
  if (isUsingMockData()) {
    return mockCreateRoom(data);
  }
  try {
    return await request<CreateRoomResponse>('/interview-rooms', {
      method: 'POST',
      body: data,
    });
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockCreateRoom(data);
    }
    throw error;
  }
}

export async function getRoomById(roomId: string): Promise<InterviewRoom> {
  if (isUsingMockData()) {
    return mockGetRoomById(roomId);
  }
  try {
    return await request<InterviewRoom>(`/interview-rooms/${roomId}`);
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockGetRoomById(roomId);
    }
    throw error;
  }
}

export async function getRoomByCode(roomCode: string): Promise<InterviewRoom> {
  if (isUsingMockData()) {
    return mockGetRoomByCode(roomCode);
  }
  try {
    return await request<InterviewRoom>(`/interview-rooms/code/${roomCode}`);
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockGetRoomByCode(roomCode);
    }
    throw error;
  }
}

export async function getRoomsByInterviewer(interviewerId: string): Promise<InterviewRoom[]> {
  if (isUsingMockData()) {
    return mockGetRoomsByInterviewer(interviewerId);
  }
  try {
    return await request<InterviewRoom[]>(`/interview-rooms/interviewer/${interviewerId}`);
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockGetRoomsByInterviewer(interviewerId);
    }
    throw error;
  }
}

export async function updateRoomStatus(roomId: string, status: string): Promise<InterviewRoom> {
  if (isUsingMockData()) {
    return mockUpdateRoomStatus(roomId, status);
  }
  try {
    return await request<InterviewRoom>(`/interview-rooms/${roomId}/status`, {
      method: 'PUT',
      body: { status },
    });
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockUpdateRoomStatus(roomId, status);
    }
    throw error;
  }
}

export interface BatchUpdateEntry {
  room: InterviewRoom;
  action: BatchRoomAction;
}

// 逐个独立执行：单个条目失败不影响其他条目，成功的更新随结果一起返回
export async function batchUpdateRoomStatuses(
  entries: BatchUpdateEntry[],
): Promise<{ results: BatchRoomResultItem[]; updatedRooms: InterviewRoom[] }> {
  const settled = await Promise.all(
    entries.map(async ({ room, action }): Promise<{ item: BatchRoomResultItem; updated?: InterviewRoom }> => {
      const targetStatus = action === 'RESTORE' ? 'WAITING' : action === 'CANCEL' ? 'CANCELLED' : 'COMPLETED';
      try {
        const updated = await updateRoomStatus(room.id, targetStatus);
        return {
          updated,
          item: {
            roomId: room.id,
            roomTitle: room.title,
            roomCode: room.roomCode,
            action,
            targetStatus,
            status: 'SUCCESS',
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error: any) {
        return {
          item: {
            roomId: room.id,
            roomTitle: room.title,
            roomCode: room.roomCode,
            action,
            targetStatus,
            status: 'FAILED',
            message: error?.message || '操作失败，请稍后重试',
            timestamp: new Date().toISOString(),
          },
        };
      }
    }),
  );

  return {
    results: settled.map((s) => s.item),
    updatedRooms: settled.filter((s): s is { item: BatchRoomResultItem; updated: InterviewRoom } => Boolean(s.updated)).map((s) => s.updated),
  };
}

export async function getRoomParticipants(roomId: string): Promise<ParticipantStatus[]> {
  if (isUsingMockData()) {
    return mockGetRoomParticipants(roomId);
  }
  try {
    return await request<ParticipantStatus[]>(`/interview-rooms/${roomId}/participants`);
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockGetRoomParticipants(roomId);
    }
    throw error;
  }
}

export async function joinRoom(roomId: string, data: { candidateName: string; inviteToken: string }): Promise<JoinRoomResponse> {
  if (isUsingMockData()) {
    return mockJoinRoom(roomId, data);
  }
  try {
    return await request<JoinRoomResponse>(`/interview-rooms/${roomId}/join`, {
      method: 'POST',
      body: data,
    });
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockJoinRoom(roomId, data);
    }
    throw error;
  }
}

export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  if (isUsingMockData()) {
    return mockLeaveRoom(roomId, userId);
  }
  try {
    return await request<void>(`/interview-rooms/${roomId}/leave`, {
      method: 'POST',
      body: { userId },
    });
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockLeaveRoom(roomId, userId);
    }
    throw error;
  }
}

export async function heartbeat(roomId: string, userId: string): Promise<ParticipantStatus> {
  if (isUsingMockData()) {
    return mockHeartbeat(roomId, userId);
  }
  try {
    return await request<ParticipantStatus>(`/interview-rooms/${roomId}/heartbeat`, {
      method: 'POST',
      body: { userId },
    });
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockHeartbeat(roomId, userId);
    }
    throw error;
  }
}
