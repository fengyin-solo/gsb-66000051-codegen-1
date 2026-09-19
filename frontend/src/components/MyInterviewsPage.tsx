import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInterviewStore } from '../store/interview';
import { useToastStore } from '../store/toast';
import {
  InterviewRoom,
  BatchRoomAction,
  BatchRoomResultItem,
  BatchRoomResultReport,
  getRoomStatusConfig,
} from '../types';
import { batchUpdateRoomStatuses, BatchUpdateEntry } from '../services/interviewRoomService';

type StatusFilter = 'ALL' | InterviewRoom['status'];

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: '全部' },
  { value: 'WAITING', label: '等待中' },
  { value: 'ACTIVE', label: '进行中' },
  { value: 'COMPLETED', label: '已结束' },
  { value: 'CANCELLED', label: '已取消' },
];

// 仅等待中 / 已结束的房间允许批量操作
const BATCHABLE_STATUSES: InterviewRoom['status'][] = ['WAITING', 'COMPLETED'];

interface ActionMeta {
  label: string;
  icon: string;
  color: string;
  targetStatus: InterviewRoom['status'];
  allowedStatuses: InterviewRoom['status'][];
  description: string;
}

const ACTION_META: Record<BatchRoomAction, ActionMeta> = {
  COMPLETE: {
    label: '收进已结束',
    icon: '✅',
    color: '#2196f3',
    targetStatus: 'COMPLETED',
    allowedStatuses: ['WAITING'],
    description: '将等待中的房间标记为已结束',
  },
  CANCEL: {
    label: '取消',
    icon: '❌',
    color: '#f44336',
    targetStatus: 'CANCELLED',
    allowedStatuses: ['WAITING'],
    description: '取消等待中的房间',
  },
  RESTORE: {
    label: '恢复',
    icon: '↩️',
    color: '#ff9800',
    targetStatus: 'WAITING',
    allowedStatuses: ['COMPLETED'],
    description: '将已结束的房间恢复为等待中',
  },
};

const reportStorageKey = (interviewerId: string) => `code_interview_batch_report_${interviewerId}`;
const filterStorageKey = (interviewerId: string) => `code_interview_room_filter_${interviewerId}`;

const buildSkippedItem = (room: InterviewRoom, action: BatchRoomAction): BatchRoomResultItem => ({
  roomId: room.id,
  roomTitle: room.title,
  roomCode: room.roomCode,
  action,
  targetStatus: ACTION_META[action].targetStatus,
  status: 'SKIPPED',
  message: `房间当前为「${getRoomStatusConfig(room.status).label}」状态，不能执行「${ACTION_META[action].label}」`,
  timestamp: new Date().toISOString(),
});

const itemKey = (item: BatchRoomResultItem) => `${item.roomId}|${item.action}`;

// 重试的条目覆盖报告中的旧条目，其余条目原样保留（部分成功不丢失）
const mergeReports = (prev: BatchRoomResultReport | null, incoming: BatchRoomResultReport): BatchRoomResultReport => {
  if (!prev) return incoming;
  const incomingKeys = new Set(incoming.items.map(itemKey));
  const kept = prev.items.filter((item) => !incomingKeys.has(itemKey(item)));
  return {
    id: incoming.id,
    action: incoming.action,
    finishedAt: incoming.finishedAt,
    items: [...incoming.items, ...kept],
  };
};

interface MyInterviewsPageProps {
  onCreateRoom: () => void;
}

export const MyInterviewsPage: React.FC<MyInterviewsPageProps> = ({ onCreateRoom }) => {
  const navigate = useNavigate();
  const {
    currentUser,
    myRooms,
    setCurrentRoom,
    mergeRoomsIntoMyRooms,
  } = useInterviewStore();
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToastStore();

  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [report, setReport] = useState<BatchRoomResultReport | null>(null);
  const [processingAction, setProcessingAction] = useState<BatchRoomAction | null>(null);
  const [persistReady, setPersistReady] = useState(false);
  const processingRef = useRef<BatchRoomAction | null>(null);

  // 打开列表时恢复上次的筛选条件与批量处理结果
  useEffect(() => {
    if (!currentUser) return;
    try {
      const savedFilter = localStorage.getItem(filterStorageKey(currentUser.id));
      if (savedFilter === 'ALL' || savedFilter === 'WAITING' || savedFilter === 'ACTIVE'
        || savedFilter === 'COMPLETED' || savedFilter === 'CANCELLED') {
        setFilter(savedFilter);
      }
      const rawReport = localStorage.getItem(reportStorageKey(currentUser.id));
      setReport(rawReport ? (JSON.parse(rawReport) as BatchRoomResultReport) : null);
    } catch {
      setReport(null);
    }
    setPersistReady(true);
  }, [currentUser]);

  // 处理结果持久化：下次打开列表仍显示刚才的处理结果
  useEffect(() => {
    if (!currentUser || !persistReady) return;
    try {
      localStorage.setItem(reportStorageKey(currentUser.id), JSON.stringify(report));
    } catch (e) {
      console.warn('Failed to persist batch report:', e);
    }
  }, [report, currentUser, persistReady]);

  useEffect(() => {
    if (!currentUser || !persistReady) return;
    try {
      localStorage.setItem(filterStorageKey(currentUser.id), filter);
    } catch (e) {
      console.warn('Failed to persist room filter:', e);
    }
  }, [filter, currentUser, persistReady]);

  // 筛选为纯前端派生：筛选结果为空时不会动到 myRooms，整页数据始终保留
  const filteredRooms = useMemo(
    () => (filter === 'ALL' ? myRooms : myRooms.filter((room) => room.status === filter)),
    [myRooms, filter],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { ALL: myRooms.length, WAITING: 0, ACTIVE: 0, COMPLETED: 0, CANCELLED: 0 };
    for (const room of myRooms) {
      counts[room.status] += 1;
    }
    return counts;
  }, [myRooms]);

  const selectableInFilter = useMemo(
    () => filteredRooms.filter((room) => BATCHABLE_STATUSES.includes(room.status)),
    [filteredRooms],
  );

  // 房间状态变化后（如在房间内结束/恢复），自动剔除已不可批量操作的勾选项
  useEffect(() => {
    const batchableIds = new Set(
      myRooms.filter((room) => BATCHABLE_STATUSES.includes(room.status)).map((room) => room.id),
    );
    setSelectedIds((ids) => {
      const next = ids.filter((id) => batchableIds.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, [myRooms]);

  const selectedRooms = useMemo(
    () => myRooms.filter((room) => selectedIds.includes(room.id) && BATCHABLE_STATUSES.includes(room.status)),
    [myRooms, selectedIds],
  );

  const allSelected = selectableInFilter.length > 0
    && selectableInFilter.every((room) => selectedIds.includes(room.id));
  const someSelected = selectableInFilter.some((room) => selectedIds.includes(room.id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      const selectableIds = new Set(selectableInFilter.map((room) => room.id));
      setSelectedIds((ids) => ids.filter((id) => !selectableIds.has(id)));
    } else {
      setSelectedIds((ids) => Array.from(new Set([...ids, ...selectableInFilter.map((room) => room.id)])));
    }
  }, [allSelected, selectableInFilter]);

  const toggleRoom = useCallback((roomId: string) => {
    setSelectedIds((ids) => (
      ids.includes(roomId) ? ids.filter((id) => id !== roomId) : [...ids, roomId]
    ));
  }, []);

  // 逐项独立执行：未生效（跳过/失败）条目不影响成功条目，结果逐项返回
  const executeEntries = useCallback(async (entries: BatchUpdateEntry[]) => {
    const action = entries[0]?.action;
    if (!action || entries.length === 0) return;

    processingRef.current = action;
    setProcessingAction(action);
    try {
      const executable: BatchUpdateEntry[] = [];
      const skippedByRoomId = new Map<string, BatchRoomResultItem>();

      // 以执行时的最新房间状态为准，状态已变化的条目按“跳过”处理并说明原因
      for (const entry of entries) {
        const latest = useInterviewStore.getState().myRooms.find((room) => room.id === entry.room.id) || entry.room;
        if (ACTION_META[entry.action].allowedStatuses.includes(latest.status)) {
          executable.push({ room: latest, action: entry.action });
        } else {
          skippedByRoomId.set(latest.id, buildSkippedItem(latest, entry.action));
        }
      }

      const { results, updatedRooms } = await batchUpdateRoomStatuses(executable);
      // 成功项就地合并进列表，不重排、不清空、不影响其他条目
      if (updatedRooms.length > 0) {
        mergeRoomsIntoMyRooms(updatedRooms);
      }

      const resultByRoomId = new Map(results.map((item) => [item.roomId, item]));
      const orderedItems: BatchRoomResultItem[] = [];
      for (const entry of entries) {
        const item = resultByRoomId.get(entry.room.id) || skippedByRoomId.get(entry.room.id);
        if (item) orderedItems.push(item);
      }

      const incomingReport: BatchRoomResultReport = {
        id: `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        action,
        finishedAt: new Date().toISOString(),
        items: orderedItems,
      };
      setReport((prev) => mergeReports(prev, incomingReport));

      const succeeded = results.filter((item) => item.status === 'SUCCESS').length;
      const failed = results.filter((item) => item.status === 'FAILED').length;
      const skipped = skippedByRoomId.size;

      // 成功项取消勾选；未生效项保留勾选，方便直接再次执行
      const failedRoomIds = new Set(
        results.filter((item) => item.status === 'FAILED').map((item) => item.roomId),
      );
      setSelectedIds((ids) => ids.filter((id) => failedRoomIds.has(id) || skippedByRoomId.has(id)));

      if (succeeded > 0 && failed === 0 && skipped === 0) {
        toastSuccess(`批量「${ACTION_META[action].label}」完成，${succeeded} 个房间已生效`);
      } else {
        const parts: string[] = [];
        if (succeeded > 0) parts.push(`成功 ${succeeded}`);
        if (failed > 0) parts.push(`未生效 ${failed}`);
        if (skipped > 0) parts.push(`跳过 ${skipped}`);
        toastInfo(`批量「${ACTION_META[action].label}」：${parts.join(' · ')}，详见处理结果`, 6000);
      }
    } catch (e) {
      console.error('Batch operation failed:', e);
      toastError('批量操作执行失败，请稍后重试');
    } finally {
      processingRef.current = null;
      setProcessingAction(null);
    }
  }, [mergeRoomsIntoMyRooms, toastSuccess, toastError, toastInfo]);

  const runBatchAction = useCallback((action: BatchRoomAction) => {
    if (processingRef.current || selectedRooms.length === 0) return;
    executeEntries(selectedRooms.map((room) => ({ room, action })));
  }, [selectedRooms, executeEntries]);

  const handleRetryItem = useCallback((item: BatchRoomResultItem) => {
    if (processingRef.current) return;
    const room = useInterviewStore.getState().myRooms.find((r) => r.id === item.roomId);
    if (!room) {
      toastError('房间已不在列表中，无法重试');
      return;
    }
    executeEntries([{ room, action: item.action }]);
  }, [executeEntries, toastError]);

  const handleEnterRoom = (room: InterviewRoom) => {
    if (processingRef.current) return;
    setCurrentRoom(room);
    navigate(`/room/${room.id}/interviewer`);
  };

  const dismissReport = () => setReport(null);

  const reportSummary = useMemo(() => {
    if (!report) return null;
    const summary = { SUCCESS: 0, FAILED: 0, SKIPPED: 0 };
    for (const item of report.items) {
      summary[item.status] += 1;
    }
    return summary;
  }, [report]);

  const actionButtonBase: React.CSSProperties = {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'opacity 0.2s',
  };

  const renderActionButton = (action: BatchRoomAction) => {
    const meta = ACTION_META[action];
    const applicable = selectedRooms.some((room) => meta.allowedStatuses.includes(room.status));
    const disabled = !applicable || processingAction !== null;
    return (
      <button
        key={action}
        onClick={() => runBatchAction(action)}
        disabled={disabled}
        title={disabled && selectedRooms.length > 0 ? meta.description : undefined}
        style={{
          ...actionButtonBase,
          background: meta.color,
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        {meta.icon} {meta.label}
      </button>
    );
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ color: '#fff', fontSize: '28px', margin: '0 0 8px 0' }}>我的面试</h1>
      <p style={{ color: '#888', margin: '0 0 24px 0' }}>管理您创建的所有面试房间，可多选等待中或已结束的房间批量处理</p>

      {/* 状态筛选：纯前端过滤，空结果只显示局部空态，不清空整页数据 */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '20px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        {FILTERS.map(({ value, label }) => {
          const active = filter === value;
          const count = statusCounts[value];
          return (
            <button
              key={value}
              onClick={() => setFilter(value)}
              style={{
                padding: '7px 16px',
                borderRadius: '16px',
                border: `1px solid ${active ? '#667eea' : '#333'}`,
                background: active ? 'rgba(102, 126, 234, 0.15)' : 'transparent',
                color: active ? '#fff' : '#888',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: active ? 600 : 400,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
              {label}
              <span style={{
                fontSize: '11px',
                background: active ? '#667eea' : '#333',
                color: '#fff',
                borderRadius: '10px',
                padding: '1px 7px',
                minWidth: '18px',
                textAlign: 'center',
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {myRooms.length === 0 ? (
        <div style={{
          background: '#1e1e1e',
          borderRadius: '12px',
          padding: '64px 24px',
          textAlign: 'center',
          border: '1px dashed #333',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
          <h3 style={{ color: '#fff', margin: '0 0 8px 0' }}>暂无面试房间</h3>
          <p style={{ color: '#888', margin: '0 0 24px 0' }}>点击右上角按钮创建您的第一个面试房间</p>
          <button
            onClick={onCreateRoom}
            style={{
              padding: '12px 32px',
              background: '#4caf50',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}>
            创建面试房间
          </button>
        </div>
      ) : (
        <>
          {/* 批量操作工具栏 */}
          {selectableInFilter.length > 0 && (
            <div style={{
              background: '#1e1e1e',
              border: '1px solid #333',
              borderRadius: '10px',
              padding: '12px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              flexWrap: 'wrap',
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ccc', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  disabled={processingAction !== null}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#667eea' }}
                />
                全选当前筛选下可操作房间
              </label>
              <div style={{ flex: 1, minWidth: '120px' }}>
                {selectedRooms.length > 0 ? (
                  <span style={{ color: '#667eea', fontSize: '13px', fontWeight: 600 }}>
                    已选 {selectedRooms.length} 个房间
                  </span>
                ) : (
                  <span style={{ color: '#666', fontSize: '12px' }}>
                    勾选房间后可批量收进已结束、取消或恢复
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {renderActionButton('COMPLETE')}
                {renderActionButton('CANCEL')}
                {renderActionButton('RESTORE')}
              </div>
            </div>
          )}

          {/* 批量处理逐项结果（持久化，下次打开仍显示） */}
          {report && reportSummary && (
            <BatchResultPanel
              report={report}
              summary={reportSummary}
              processingAction={processingAction}
              onRetry={handleRetryItem}
              onDismiss={dismissReport}
            />
          )}

          {filteredRooms.length === 0 ? (
            <div style={{
              background: '#1e1e1e',
              borderRadius: '12px',
              padding: '48px 24px',
              textAlign: 'center',
              border: '1px dashed #333',
            }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔍</div>
              <h3 style={{ color: '#fff', margin: '0 0 8px 0' }}>当前筛选下没有房间</h3>
              <p style={{ color: '#888', margin: '0 0 20px 0', fontSize: '13px' }}>其他状态的房间仍保留在列表数据中，未被清空</p>
              <button
                onClick={() => setFilter('ALL')}
                style={{
                  padding: '8px 20px',
                  background: 'transparent',
                  color: '#667eea',
                  border: '1px solid #667eea',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}>
                查看全部房间
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '16px' }}>
              {filteredRooms.map((room) => {
                const batchable = BATCHABLE_STATUSES.includes(room.status);
                const selected = selectedIds.includes(room.id);
                const statusColor = getRoomStatusConfig(room.status).color;
                const statusLabel = getRoomStatusConfig(room.status).label;
                return (
                  <div
                    key={room.id}
                    onClick={() => handleEnterRoom(room)}
                    style={{
                      background: '#1e1e1e',
                      borderRadius: '12px',
                      padding: '20px 24px',
                      border: `1px solid ${selected ? '#667eea' : '#333'}`,
                      boxShadow: selected ? '0 0 0 1px #667eea inset' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) e.currentTarget.style.borderColor = '#4caf50';
                      e.currentTarget.style.transform = 'translateX(4px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = selected ? '#667eea' : '#333';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!batchable || processingAction !== null}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleRoom(room.id)}
                      title={batchable ? undefined : '仅等待中或已结束的房间可批量操作'}
                      style={{
                        width: '18px',
                        height: '18px',
                        cursor: batchable ? 'pointer' : 'not-allowed',
                        accentColor: '#667eea',
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <div>
                          <h3 style={{ color: '#fff', margin: '0 0 4px 0', fontSize: '18px' }}>{room.title}</h3>
                          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                            <span style={{ color: '#888', fontSize: '13px' }}>
                              房间码: <span style={{ color: '#4caf50', fontFamily: 'monospace', fontWeight: 'bold' }}>{room.roomCode}</span>
                            </span>
                            <span style={{
                              padding: '4px 12px',
                              borderRadius: '12px',
                              fontSize: '11px',
                              fontWeight: 500,
                              background: `${statusColor}20`,
                              color: statusColor,
                            }}>
                              {statusLabel}
                            </span>
                          </div>
                        </div>
                        <span style={{ color: '#4caf50', fontSize: '20px' }}>→</span>
                      </div>
                      <div style={{ color: '#666', fontSize: '12px' }}>
                        创建于 {new Date(room.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

interface BatchResultPanelProps {
  report: BatchRoomResultReport;
  summary: { SUCCESS: number; FAILED: number; SKIPPED: number };
  processingAction: BatchRoomAction | null;
  onRetry: (item: BatchRoomResultItem) => void;
  onDismiss: () => void;
}

const BatchResultPanel: React.FC<BatchResultPanelProps> = ({ report, summary, processingAction, onRetry, onDismiss }) => {
  const [collapsed, setCollapsed] = useState(false);

  const statusStyle: Record<BatchRoomResultItem['status'], { label: string; color: string; icon: string }> = {
    SUCCESS: { label: '已生效', color: '#4caf50', icon: '✓' },
    FAILED: { label: '未生效', color: '#f44336', icon: '✕' },
    SKIPPED: { label: '已跳过', color: '#888', icon: '–' },
  };

  return (
    <div style={{
      background: '#1e1e1e',
      border: '1px solid #333',
      borderRadius: '10px',
      marginBottom: '16px',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        borderBottom: collapsed ? 'none' : '1px solid #333',
        background: '#222',
      }}>
        <span style={{ fontSize: '15px' }}>📊</span>
        <span style={{ color: '#fff', fontSize: '14px', fontWeight: 600 }}>批量处理结果</span>
        <div style={{ display: 'flex', gap: '8px', fontSize: '12px' }}>
          <span style={{ color: '#4caf50' }}>已生效 {summary.SUCCESS}</span>
          <span style={{ color: '#f44336' }}>未生效 {summary.FAILED}</span>
          <span style={{ color: '#888' }}>跳过 {summary.SKIPPED}</span>
        </div>
        <span style={{ color: '#666', fontSize: '11px', marginLeft: 'auto' }}>
          {new Date(report.finishedAt).toLocaleString('zh-CN')}
        </span>
        <button
          onClick={() => setCollapsed((v) => !v)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '13px',
            padding: '2px 8px',
          }}>
          {collapsed ? '展开' : '收起'}
        </button>
        <button
          onClick={onDismiss}
          title="关闭结果面板"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0 4px',
          }}>
          ×
        </button>
      </div>

      {!collapsed && (
        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {report.items.map((item) => {
            const meta = ACTION_META[item.action];
            const s = statusStyle[item.status];
            const targetConfig = getRoomStatusConfig(item.targetStatus);
            return (
              <div
                key={itemKey(item)}
                style={{
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  borderBottom: '1px solid #2a2a2a',
                  fontSize: '13px',
                }}>
                <span style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: `${s.color}22`,
                  color: s.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {s.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#ddd', fontWeight: 500 }}>
                    {item.roomTitle}
                    <span style={{ color: '#666', fontFamily: 'monospace', marginLeft: '8px', fontSize: '12px' }}>{item.roomCode}</span>
                  </div>
                  {item.message && (
                    <div style={{ color: item.status === 'FAILED' ? '#f44336' : '#777', fontSize: '12px', marginTop: '2px' }}>
                      {item.message}
                    </div>
                  )}
                </div>
                <span style={{ color: '#888', fontSize: '12px', flexShrink: 0 }}>
                  {meta.icon} {meta.label} → <span style={{ color: targetConfig.color }}>{targetConfig.label}</span>
                </span>
                <span style={{
                  color: s.color,
                  fontSize: '12px',
                  fontWeight: 600,
                  width: '52px',
                  textAlign: 'right',
                  flexShrink: 0,
                }}>
                  {s.label}
                </span>
                {item.status === 'FAILED' && (
                  <button
                    onClick={() => onRetry(item)}
                    disabled={processingAction !== null}
                    style={{
                      padding: '4px 12px',
                      background: 'transparent',
                      color: '#f44336',
                      border: '1px solid #f44336',
                      borderRadius: '4px',
                      cursor: processingAction ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      flexShrink: 0,
                      opacity: processingAction ? 0.5 : 1,
                    }}>
                    重试
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
