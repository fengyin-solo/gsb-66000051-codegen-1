package com.codeinterview.dto;

import com.codeinterview.model.InterviewRoom;

public class BatchRoomStatusItemResult {

    private String roomId;
    private String targetStatus;
    private boolean success;
    private String message;
    private InterviewRoom room;

    public BatchRoomStatusItemResult() {
    }

    public BatchRoomStatusItemResult(String roomId, String targetStatus, boolean success, String message, InterviewRoom room) {
        this.roomId = roomId;
        this.targetStatus = targetStatus;
        this.success = success;
        this.message = message;
        this.room = room;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
    }

    public String getTargetStatus() {
        return targetStatus;
    }

    public void setTargetStatus(String targetStatus) {
        this.targetStatus = targetStatus;
    }

    public boolean isSuccess() {
        return success;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public InterviewRoom getRoom() {
        return room;
    }

    public void setRoom(InterviewRoom room) {
        this.room = room;
    }
}
