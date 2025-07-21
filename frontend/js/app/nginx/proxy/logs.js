const Mn       = require('backbone.marionette');
const App      = require('../../main');
const template = require('./logs.ejs');

module.exports = Mn.View.extend({
    template: template,
    className: 'modal-dialog wide',
    
    // Real-time refresh timer
    realTimeTimer: null,
    realTimeInterval: 3000, // 3 seconds
    lastLogs: [], // Store last logs for comparison

    ui: {
        refresh: '.refresh-logs',
        lines:   'select[name="lines"]',
        logType: 'select[name="log-type"]',
        content: '.log-content',
        logTitle: '.log-title',
        realTime: 'input[name="real-time"]',
        realTimeInfo: '.real-time-info',
        cancel:  'button.cancel'
    },

    events: {
        'click @ui.refresh': function (e) {
            e.preventDefault();
            this.loadLogs(true); // Force show loader for manual refresh
        },

        'change @ui.lines': function () {
            this.lastLogs = []; // Reset logs on settings change
            this.loadLogs(true); // Show loader for settings change
            // Restart real-time if it was active
            if (this.ui.realTime.is(':checked')) {
                this.startRealTime();
            }
        },

        'change @ui.logType': function () {
            this.updateTitle();
            this.lastLogs = []; // Reset logs on type change
            this.loadLogs(true); // Show loader for type change
            // Restart real-time if it was active  
            if (this.ui.realTime.is(':checked')) {
                this.startRealTime();
            }
        },

        'change @ui.realTime': function () {
            this.toggleRealTime();
        }
    },

    templateContext: function () {
        return {
            host_id: this.model.get('id'),
            domain_names: this.model.get('domain_names') || []
        };
    },

    loadLogs: function (showLoader) {
        const view = this;
        const host_id = this.model.get('id');
        const lines = parseInt(this.ui.lines.val(), 10) || 100;
        const logType = this.ui.logType ? this.ui.logType.val() : 'access';
        const isRealTime = this.ui.realTime.is(':checked');

        // Show loader only if not real-time or explicitly requested
        if (showLoader !== false && (!isRealTime || this.lastLogs.length === 0)) {
            this.ui.content.html('<div class="text-center"><i class="fe fe-loader"></i> ' + App.i18n('str', 'loading') + '</div>');
        }

        App.Api.Nginx.ProxyHosts.getLogs(host_id, lines, logType)
            .then(function (response) {
                if (response.logs && response.logs.length > 0) {
                    
                    if (isRealTime && view.lastLogs.length > 0) {
                        // Real-time mode: append only new logs
                        view.appendNewLogs(response.logs);
                    } else {
                        // Normal mode or first load: replace all content
                        const logsHtml = response.logs.map(function(line) {
                            return '<div class="log-line">' + line.toHtmlEntities() + '</div>';
                        }).join('');
                        view.ui.content.html(logsHtml);
                    }
                    
                    // Store current logs for next comparison
                    view.lastLogs = response.logs.slice();
                    
                    // Auto-scroll to bottom if real-time is enabled
                    if (isRealTime) {
                        view.ui.content.scrollTop(view.ui.content[0].scrollHeight);
                    }
                } else {
                    view.ui.content.html('<div class="text-muted text-center">' + App.i18n('str', 'logs-empty') + '</div>');
                    view.lastLogs = [];
                }
            })
            .catch(function (err) {
                view.ui.content.html('<div class="text-danger text-center">' + App.i18n('str', 'logs-error', {error: err.message || 'Unknown error'}) + '</div>');
            });
    },

    updateTitle: function () {
        const logType = this.ui.logType ? this.ui.logType.val() : 'access';
        const title = logType === 'access' ? App.i18n('str', 'access-logs') : App.i18n('str', 'error-logs');
        if (this.ui.logTitle.length > 0) {
            this.ui.logTitle.text(title);
        }
        
        // Apply error logs styling
        if (logType === 'error') {
            this.ui.content.addClass('error-logs');
        } else {
            this.ui.content.removeClass('error-logs');
        }
    },

    toggleRealTime: function () {
        const isEnabled = this.ui.realTime.is(':checked');
        
        if (isEnabled) {
            // Start real-time updates
            this.startRealTime();
            this.ui.realTimeInfo.show();
            this.ui.refresh.prop('disabled', true).addClass('btn-disabled real-time-active');
        } else {
            // Stop real-time updates
            this.stopRealTime();
            this.ui.realTimeInfo.hide();
            this.ui.refresh.prop('disabled', false).removeClass('btn-disabled real-time-active');
            // Clear stored logs when disabling real-time
            this.lastLogs = [];
        }
    },

    startRealTime: function () {
        const view = this;
        
        // Clear existing timer
        this.stopRealTime();
        
        // Start new timer
        this.realTimeTimer = setInterval(function() {
            view.loadLogs();
        }, this.realTimeInterval);
    },

    appendNewLogs: function (newLogs) {
        const view = this;
        
        // Find new logs that weren't in the last batch
        let newEntries = [];
        let lastLogIndex = -1;
        
        // Find where old logs end in new logs
        if (view.lastLogs.length > 0) {
            const lastOldLog = view.lastLogs[view.lastLogs.length - 1];
            lastLogIndex = newLogs.lastIndexOf(lastOldLog);
        }
        
        // Get only new entries
        if (lastLogIndex >= 0 && lastLogIndex < newLogs.length - 1) {
            newEntries = newLogs.slice(lastLogIndex + 1);
        } else if (lastLogIndex === -1) {
            // If we can't find overlap, check if we have completely new logs
            const hasAnyOverlap = view.lastLogs.some(function(oldLog) {
                return newLogs.indexOf(oldLog) !== -1;
            });
            
            if (!hasAnyOverlap) {
                // No overlap found, add all new logs
                newEntries = newLogs;
            }
        }
        
        // Append new entries
        if (newEntries.length > 0) {
            const newLogsHtml = newEntries.map(function(line) {
                return '<div class="log-line">' + line.toHtmlEntities() + '</div>';
            }).join('');
            view.ui.content.append(newLogsHtml);
            
            // Limit total number of visible logs to prevent memory issues
            const maxLines = parseInt(view.ui.lines.val(), 10) || 100;
            const logLines = view.ui.content.find('.log-line');
            if (logLines.length > maxLines) {
                logLines.slice(0, logLines.length - maxLines).remove();
            }
        }
    },

    stopRealTime: function () {
        if (this.realTimeTimer) {
            clearInterval(this.realTimeTimer);
            this.realTimeTimer = null;
        }
    },

    onRender: function () {
        this.updateTitle();
        this.lastLogs = []; // Initialize empty logs array
        this.loadLogs(true); // Show loader for initial load
    },

    onDestroy: function () {
        // Clean up timer when modal is closed
        this.stopRealTime();
    }
}); 