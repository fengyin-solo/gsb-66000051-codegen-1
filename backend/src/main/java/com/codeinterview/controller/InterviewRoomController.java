package com.codeinterview.controller;

import com.codeinterview.dto.BatchRoomStatusItemResult;
import com.codeinterview.dto.BatchRoomStatusRequest;
import com.codeinterview.dto.BatchRoomStatusResponse;
import com.codeinterview.dto.CreateRoomResponse;
import com.codeinterview.dto.JoinRoomResponse;
import com.codeinterview.dto.WebSocketMessage;
import com.codeinterview.model.CandidateInvitation;
import com.codeinterview.model.InterviewRoom;
import com.codeinterview.model.ParticipantStatus;
import com.codeinterview.repository.CandidateInvitationRepository;
import com.codeinterview.repository.InterviewRoomRepository;
import com.codeinterview.repository.ParticipantStatusRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import java.util.Set;

@RestController
@RequestMapping("/api/interview-rooms")
@CrossOrigin(origins = "*")
public class InterviewRoomController {

    @Autowired
    private InterviewRoomRepository interviewRoomRepository;

    @Autowired
    private CandidateInvitationRepository candidateInvitationRepository;

    @Autowired
    private ParticipantStatusRepository participantStatusRepository;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    private static final String ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final int ROOM_CODE_LENGTH = 6;

    @PostMapping
    @Transactional
    public ResponseEntity<CreateRoomResponse> createInterviewRoom(@RequestBody Map<String, String> request) {
        String title = request.get("title");
        String problemId = request.get("problemId");
        String interviewerId = request.get("interviewerId");
        String interviewerName = request.get("interviewerName");

        InterviewRoom room = new InterviewRoom();
        room.setTitle(title);
        room.setProblemId(problemId);
        room.setInterviewerId(interviewerId);
        room.setStatus("WAITING");
        room.setRoomCode(generateUniqueRoomCode());
        room.setCreatedAt(LocalDateTime.now());

        InterviewRoom savedRoom = interviewRoomRepository.save(room);

        ParticipantStatus interviewerStatus = new ParticipantStatus();
        interviewerStatus.setRoomId(savedRoom.getId());
        interviewerStatus.setUserId(interviewerId);
        interviewerStatus.setUserName(interviewerName);
        interviewerStatus.setUserRole("INTERVIEWER");
        interviewerStatus.setOnline(true);
        interviewerStatus.setLastHeartbeat(LocalDateTime.now());
        interviewerStatus.setJoinedAt(LocalDateTime.now());
        ParticipantStatus savedInterviewerStatus = participantStatusRepository.save(interviewerStatus);

        return new ResponseEntity<>(new CreateRoomResponse(savedRoom, savedInterviewerStatus), HttpStatus.CREATED);
    }

    @GetMapping("/{roomId}")
    public ResponseEntity<InterviewRoom> getInterviewRoomById(@PathVariable String roomId) {
        Optional<InterviewRoom> room = interviewRoomRepository.findById(roomId);
        return room.map(ResponseEntity::ok)
                .orElseGet(() -> new ResponseEntity<>(HttpStatus.NOT_FOUND));
    }

    @GetMapping("/code/{roomCode}")
    public ResponseEntity<InterviewRoom> getInterviewRoomByCode(@PathVariable String roomCode) {
        Optional<InterviewRoom> room = interviewRoomRepository.findByRoomCode(roomCode);
        return room.map(ResponseEntity::ok)
                .orElseGet(() -> new ResponseEntity<>(HttpStatus.NOT_FOUND));
    }

    @GetMapping("/interviewer/{interviewerId}")
    public ResponseEntity<List<InterviewRoom>> getInterviewRoomsByInterviewer(@PathVariable String interviewerId) {
        List<InterviewRoom> rooms = interviewRoomRepository.findByInterviewerIdOrderByCreatedAtDesc(interviewerId);
        return new ResponseEntity<>(rooms, HttpStatus.OK);
    }

    @PutMapping("/{roomId}/status")
    @Transactional
    public ResponseEntity<InterviewRoom> updateRoomStatus(@PathVariable String roomId, @RequestBody Map<String, String> request) {
        String status = request.get("status");
        Optional<InterviewRoom> roomOpt = interviewRoomRepository.findById(roomId);

        if (roomOpt.isEmpty()) {
            return new ResponseEntity<>(HttpStatus.NOT_FOUND);
        }

        InterviewRoom room = roomOpt.get();
        room.setStatus(status);

        if ("ACTIVE".equals(status) && room.getStartedAt() == null) {
            room.setStartedAt(LocalDateTime.now());
        } else if (("COMPLETED".equals(status) || "CANCELLED".equals(status)) && room.getEndedAt() == null) {
            room.setEndedAt(LocalDateTime.now());
        }

        InterviewRoom updatedRoom = interviewRoomRepository.save(room);
        return new ResponseEntity<>(updatedRoom, HttpStatus.OK);
    }

    /**
     * 批量变更房间状态（结束 / 取消 / 恢复）。
     * 每个条目独立处理：单个条目失败不会回滚其它已成功条目，
     * 响应中逐项返回结果，未生效条目可由前端单独重试。
     * 刻意不加类级/方法级事务，避免某个条目出错导致整批回滚。
     */
    @PostMapping("/batch-status")
    public ResponseEntity<BatchRoomStatusResponse> batchUpdateRoomStatus(@RequestBody BatchRoomStatusRequest request) {
        List<BatchRoomStatusItemResult> results = new ArrayList<>();

        if (request == null || request.getItems() == null || request.getItems().isEmpty()) {
            return new ResponseEntity<>(new BatchRoomStatusResponse(null, results), HttpStatus.BAD_REQUEST);
        }

        String action = null;
        for (BatchRoomStatusRequest.Item item : request.getItems()) {
            String roomId = item.getRoomId();
            String targetStatus = item.getTargetStatus();
            if (action == null) {
                action = targetStatus;
            }

            if (roomId == null || roomId.trim().isEmpty() || targetStatus == null || targetStatus.trim().isEmpty()) {
                results.add(new BatchRoomStatusItemResult(roomId, targetStatus, false, "房间ID和目标状态不能为空", null));
                continue;
            }

            Optional<InterviewRoom> roomOpt = interviewRoomRepository.findById(roomId);
            if (roomOpt.isEmpty()) {
                results.add(new BatchRoomStatusItemResult(roomId, targetStatus, false, "房间不存在", null));
                continue;
            }

            InterviewRoom room = roomOpt.get();
            String currentStatus = room.getStatus();
            if (!isBatchTransitionAllowed(currentStatus, targetStatus)) {
                results.add(new BatchRoomStatusItemResult(roomId, targetStatus, false,
                        "当前状态「" + statusLabel(currentStatus) + "」不支持此操作", null));
                continue;
            }

            try {
                applyStatusChange(room, targetStatus);
                InterviewRoom savedRoom = interviewRoomRepository.save(room);
                results.add(new BatchRoomStatusItemResult(roomId, targetStatus, true, "操作成功", savedRoom));
            } catch (Exception e) {
                results.add(new BatchRoomStatusItemResult(roomId, targetStatus, false,
                        "保存失败：" + e.getMessage(), null));
            }
        }

        return new ResponseEntity<>(new BatchRoomStatusResponse(action, results), HttpStatus.OK);
    }

    /**
     * 批量管理允许的状态流转：
     * 等待中 -> 已结束 / 已取消；已完成 -> 等待中（恢复）。
     * 进行中、已取消的房间不参与批量管理。
     */
    private boolean isBatchTransitionAllowed(String currentStatus, String targetStatus) {
        if (currentStatus == null || targetStatus == null || !Set.of("COMPLETED", "CANCELLED", "WAITING").contains(targetStatus)) {
            return false;
        }
        return switch (targetStatus) {
            case "COMPLETED", "CANCELLED" -> "WAITING".equals(currentStatus);
            case "WAITING" -> "COMPLETED".equals(currentStatus);
            default -> false;
        };
    }

    private void applyStatusChange(InterviewRoom room, String targetStatus) {
        room.setStatus(targetStatus);
        if ("COMPLETED".equals(targetStatus) || "CANCELLED".equals(targetStatus)) {
            if (room.getEndedAt() == null) {
                room.setEndedAt(LocalDateTime.now());
            }
        } else if ("WAITING".equals(targetStatus)) {
            // 恢复为等待中：清除结束/开始时间，房间重新回到可开始状态
            room.setEndedAt(null);
            room.setStartedAt(null);
        }
    }

    private String statusLabel(String status) {
        if (status == null) {
            return "未知";
        }
        return switch (status) {
            case "WAITING" -> "等待中";
            case "ACTIVE" -> "进行中";
            case "COMPLETED" -> "已结束";
            case "CANCELLED" -> "已取消";
            default -> status;
        };
    }

    @GetMapping("/{roomId}/participants")
    public ResponseEntity<List<ParticipantStatus>> getRoomParticipants(@PathVariable String roomId) {
        List<ParticipantStatus> participants = participantStatusRepository.findByRoomId(roomId);
        return new ResponseEntity<>(participants, HttpStatus.OK);
    }

    @PostMapping("/{roomId}/join")
    @Transactional
    public ResponseEntity<JoinRoomResponse> joinRoom(@PathVariable String roomId, @RequestBody Map<String, String> request) {
        String candidateName = request.get("candidateName");
        String inviteToken = request.get("inviteToken");

        Optional<InterviewRoom> roomOpt = interviewRoomRepository.findById(roomId);
        if (roomOpt.isEmpty()) {
            return new ResponseEntity<>(HttpStatus.NOT_FOUND);
        }
        InterviewRoom room = roomOpt.get();

        String message = "Joined via room code";

        if (inviteToken != null && !inviteToken.trim().isEmpty()) {
            Optional<CandidateInvitation> invitationOpt = candidateInvitationRepository.findByInviteToken(inviteToken);
            if (invitationOpt.isEmpty()) {
                return new ResponseEntity<>(HttpStatus.UNAUTHORIZED);
            }

            CandidateInvitation invitation = invitationOpt.get();
            if (!invitation.getRoomId().equals(roomId)) {
                return new ResponseEntity<>(HttpStatus.BAD_REQUEST);
            }

            invitation.setStatus("JOINED");
            invitation.setJoinedAt(LocalDateTime.now());
            candidateInvitationRepository.save(invitation);
            message = "Joined via invitation token";
        }

        ParticipantStatus candidateStatus = new ParticipantStatus();
        candidateStatus.setRoomId(roomId);
        candidateStatus.setUserName(candidateName);
        candidateStatus.setUserRole("CANDIDATE");
        candidateStatus.setOnline(true);
        candidateStatus.setLastHeartbeat(LocalDateTime.now());
        candidateStatus.setJoinedAt(LocalDateTime.now());
        ParticipantStatus savedStatus = participantStatusRepository.save(candidateStatus);

        savedStatus.setUserId(savedStatus.getId());
        participantStatusRepository.save(savedStatus);

        List<ParticipantStatus> participants = participantStatusRepository.findByRoomId(roomId);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/participants",
                new WebSocketMessage<>("PARTICIPANTS_UPDATE", participants));

        JoinRoomResponse response = new JoinRoomResponse(savedStatus, room, message);
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    @PostMapping("/{roomId}/leave")
    @Transactional
    public ResponseEntity<Void> leaveRoom(@PathVariable String roomId, @RequestBody Map<String, String> request) {
        String userId = request.get("userId");

        Optional<ParticipantStatus> statusOpt = participantStatusRepository.findByRoomIdAndUserId(roomId, userId);
        if (statusOpt.isEmpty()) {
            return new ResponseEntity<>(HttpStatus.NOT_FOUND);
        }

        ParticipantStatus status = statusOpt.get();
        status.setOnline(false);
        participantStatusRepository.save(status);

        List<ParticipantStatus> participants = participantStatusRepository.findByRoomId(roomId);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/participants",
                new WebSocketMessage<>("PARTICIPANTS_UPDATE", participants));

        return new ResponseEntity<>(HttpStatus.OK);
    }

    @PostMapping("/{roomId}/heartbeat")
    @Transactional
    public ResponseEntity<ParticipantStatus> heartbeat(@PathVariable String roomId, @RequestBody Map<String, String> request) {
        String userId = request.get("userId");

        Optional<ParticipantStatus> statusOpt = participantStatusRepository.findByRoomIdAndUserId(roomId, userId);
        if (statusOpt.isEmpty()) {
            return new ResponseEntity<>(HttpStatus.NOT_FOUND);
        }

        ParticipantStatus status = statusOpt.get();
        status.setOnline(true);
        status.setLastHeartbeat(LocalDateTime.now());
        ParticipantStatus updatedStatus = participantStatusRepository.save(status);

        List<ParticipantStatus> participants = participantStatusRepository.findByRoomId(roomId);
        messagingTemplate.convertAndSend("/topic/room/" + roomId + "/participants",
                new WebSocketMessage<>("PARTICIPANTS_UPDATE", participants));

        return new ResponseEntity<>(updatedStatus, HttpStatus.OK);
    }

    private String generateUniqueRoomCode() {
        Random random = new Random();
        String code;
        do {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < ROOM_CODE_LENGTH; i++) {
                sb.append(ROOM_CODE_CHARS.charAt(random.nextInt(ROOM_CODE_CHARS.length())));
            }
            code = sb.toString();
        } while (interviewRoomRepository.existsByRoomCode(code));
        return code;
    }
}
