import { request } from './api';
import type {
  CreateRoomRequest,
  InterviewRoom,
  ParticipantStatus,
  JoinRoomResponse,
  CreateRoomResponse,
  BatchRoomAction,
  BatchRoomStatusResponse,
} from '../types';
import {
  mockCreateRoom,
  mockGetRoomById,
  mockGetRoomByCode,
  mockGetRoomsByInterviewer,
  mockUpdateRoomStatus,
  mockBatchUpdateRoomStatuses,
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

/**
 * 批量变更房间状态。逐项返回成功/失败结果：
 * 已成功的条目由调用方更新列表，未生效的条目可单独重试。
 */
export async function batchUpdateRoomStatuses(
  items: { roomId: string; targetStatus: BatchRoomAction }[]
): Promise<BatchRoomStatusResponse> {
  if (isUsingMockData()) {
    return mockBatchUpdateRoomStatuses(items);
  }
  try {
    return await request<BatchRoomStatusResponse>('/interview-rooms/batch-status', {
      method: 'POST',
      body: { items },
    });
  } catch (error: any) {
    if (handleApiError(error)) {
      return mockBatchUpdateRoomStatuses(items);
    }
    throw error;
  }
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
