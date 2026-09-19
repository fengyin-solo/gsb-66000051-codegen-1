package com.codeinterview.dto;

import java.util.List;

public class BatchRoomStatusResponse {

    private String action;
    private int total;
    private int successCount;
    private int failedCount;
    private List<BatchRoomStatusItemResult> results;

    public BatchRoomStatusResponse() {
    }

    public BatchRoomStatusResponse(String action, List<BatchRoomStatusItemResult> results) {
        this.action = action;
        this.results = results;
        this.total = results.size();
        this.successCount = (int) results.stream().filter(BatchRoomStatusItemResult::isSuccess).count();
        this.failedCount = total - successCount;
    }

    public String getAction() {
        return action;
    }

    public void setAction(String action) {
        this.action = action;
    }

    public int getTotal() {
        return total;
    }

    public void setTotal(int total) {
        this.total = total;
    }

    public int getSuccessCount() {
        return successCount;
    }

    public void setSuccessCount(int successCount) {
        this.successCount = successCount;
    }

    public int getFailedCount() {
        return failedCount;
    }

    public void setFailedCount(int failedCount) {
        this.failedCount = failedCount;
    }

    public List<BatchRoomStatusItemResult> getResults() {
        return results;
    }

    public void setResults(List<BatchRoomStatusItemResult> results) {
        this.results = results;
    }
}
