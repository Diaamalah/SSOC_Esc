// ==UserScript==
// @name         RUMI - Zendesk
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  RUMI button functionality for Zendesk workflows
// @author       QWJiYXM=
// @match        *://*.zendesk.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Core variables needed for RUMI
    let username = '';
    let observerDisconnected = false;
    let fieldVisibilityState = 'all'; // 'all' or 'minimal'
    let globalButton = null;
    // Hala functionality now handles automatic group assignment instead of toast

    // Performance optimization variables
    let domCache = new Map();
    let debounceTimers = new Map();

    // RUMI Enhancement variables for automated ticket status management
    let rumiEnhancement = {
        isMonitoring: false,
        selectedViews: new Set(),
        processedTickets: new Set(),
        baselineTickets: new Map(), // view_id -> Set of ticket IDs
        ticketStatusHistory: new Map(), // ticket_id -> {status, lastProcessed, attempts}
        automationLogs: [], // Store automation logs for dashboard display
        processedHistory: [],
        pendingTickets: [],
        solvedTickets: [],
        rtaTickets: [],
        // Separate tracking for automatic vs manual processing
        automaticTickets: {
            pending: [],
            solved: [],
            rta: []
        },
        manualTickets: {
            pending: [],
            solved: [],
            rta: []
        },
        lastCheckTime: null,
        checkInterval: null,
        consecutiveErrors: 0,
        apiCallCount: 0,
        lastApiReset: Date.now(),
        isDryRun: true, // Legacy - keep for compatibility
        dryRunModes: {
            automatic: true,
            manual: true
        },
        activeTab: 'automatic', // Track active main tab
        currentLogLevel: 2, // 0=ERROR, 1=WARN, 2=INFO, 3=DEBUG
        // Monitoring session tracking
        monitoringStats: {
            sessionStartTime: null,
            sessionStopTime: null,
            totalRunningTime: 0, // milliseconds
            sessionHistory: [], // Array of {start, stop, duration} objects
            currentSessionStart: null
        },
        operationModes: {
            pending: true,
            solved: true,
            rta: true
        },
        enabledPendingPhrases: null, // Will be initialized to all enabled
        enabledSolvedPhrases: null, // Will be initialized to all enabled
        config: {
            CHECK_INTERVAL: 10000,       // 10 seconds like notify extension
            MIN_INTERVAL: 10000,         // Minimum 10 seconds
            MAX_INTERVAL: 60000,         // Maximum 60 seconds
            MAX_RETRIES: 1,              // Minimal retries like notify extension
            RATE_LIMIT: 600,             // Back to higher limit since we'll be more efficient
            CIRCUIT_BREAKER_THRESHOLD: 5 // More tolerant of 429 errors
        },
        pendingTriggerPhrases: [
            // ===============================================================
            // ESCALATION PHRASES (English)
            // ===============================================================
            "We have directed this matter to the most appropriate support team, who will be reaching out to you as soon as possible. In the meantime, if you feel more information could be helpful, please reply to this message.",
            "We have escalated this matter to a specialized support team, who will be reaching out to you as soon as possible.",
            "We have escalated this to a specialized support team who will be reaching out to you as soon as possible.",
            "We have escalated this to a specialised support team who will be reaching out to you as soon as possible.",
            "I would like to reassure you that we are treating this with the utmost seriousness. A member of our team will be in touch with you shortly.",
            "EMEA Urgent Triage Team zzzDUT",
            "https://blissnxt.uberinternal.com",
            "https://uber.lighthouse-cloud.com",
            "1st call attempt",
            "2nd call attempt",
            "3rd call attempt",
            "We've forwarded this issue to a specialized support team who will contact you as soon as possible",
            "please re-escalate if urgent concerns are confirmed",

            // ===============================================================
            // MORE INFO NEEDED PHRASES (English)
            // ===============================================================
            "In order to be able to take the right action, we want you to provide us with more information about what happened",
            "In the meantime, if you feel additional information could be helpful, please reply to this message. We'll be sure to follow-up",
            "In the meantime, this contact thread will say \"Waiting for your reply,\" but there is nothing else needed from you right now",
            "Any additional information would be beneficial to our investigation.",
            "We'll keep an eye out for your reply",

            // ===============================================================
            // WAITING FOR REPLY PHRASES (English)
            // ===============================================================
            "Will be waiting for your reply",
            "Awaiting your reply.",
            "Waiting for your reply.",
            "Waiting for your kind response.",

            // ===============================================================
            // INTERNAL NOTES/ACTIONS (English)
            // ===============================================================
            "more info",
            "- More info needed",
            "-More info needed",
            "- Asking for more info.",
            "-Asking for more info.",
            "- More Info needed - FP Blocked -Set Reported by / Reported against",
            "-More info needed -FB Blocked Updated safety reported by to RIDER",
            "MORE INFO NEEDED",
            "MORE INFO",

            // ===============================================================
            // ESCALATION PHRASES (Arabic)
            // ===============================================================
            "لقد قمنا بتصعيد هذا الأمر إلى الفريق المختص، والذي سيقوم بالتواصل معك في أقرب وقت ممكن.",
            "لقد قمنا بتصعيد هذه المشكلة إلى فريق دعم مُتخصِّص وسيتواصل معك في أسرع وقت ممكن",
            "أسف لسماع هذه التجربة. لقد قمنا بتصعيد الأمر إلى فريق دعم متخصص",

            // ===============================================================
            // MORE INFO NEEDED PHRASES (Arabic)
            // ===============================================================
            "لمساعدتنا في اتخاذ الإجراء اللازم، يُرجى توضيح مزيد من التفاصيل عن ما حدث معك أثناء الرحلة.",
            "علمًا بأن أي تفاصيل إضافية ستساعدنا في مراجعتنا للرحلة وأخذ الإجراء الداخلي المناسب",
            "إذا كنتِ تعتقدين أن المزيد من المعلومات قد يفيدكِ، يُرجى الرد على هذه الرسالة.",
            "إذا كنت تعتقد أن أي معلومات إضافية قد تكون مفيدة، يُرجى الرد على هذه الرسالة.",

            // ===============================================================
            // WAITING FOR REPLY PHRASES (Arabic)
            // ===============================================================
            "في انتظار ردك.",
            "في انتظار ردكِ",
            "ننتظر ردك",
            "ننتظر ردكِ",
            "في انتظار الرد"
        ],

        solvedTriggerPhrases: [
            "Rest assured, we take these kinds of allegations very seriously and we will be taking the appropriate actions with the partner driver involved. As of this message, we have also made some changes in the application to reduce the chance of you being paired with this partner driver in the future. If you are ever matched again, please cancel the trip and reach out to us through the application.",
            "Thanks for your understanding",
            "وقد اتخذنا بالفعل الإجراء المناسب داخلياً بشأن حساب السائق",
"نود إعلامكِ أننا قد تلقينا رسالتكِ، وسوف يقوم أحد أعضاء الفريق المختص لدينا بالتواصل معكِ من خلال رسالة أخرى بخصوص استفساركِ في أقرب وقت ممكن",
"نود إعلامك أننا قد تلقينا رسالتك، وسوف يقوم أحد أعضاء الفريق المختص لدينا بالتواصل معك من خلال رسالة أخرى بخصوص استفسارك في أقرب وقت ممكن",
"فإننا نأخذ مثل هذه الادِّعاءات على محمل الجد، وسنتَّخذ الإجراءات الداخلية الملائمة بحق السائق المتورط في الأمر",
"قد أجرينا أيضاً بعض التغييرات في التطبيق للتقليل من فرص",
"وسوف نقوم بمتابعة التحقيق واتخاذ الإجراءات اللازمة داخليًا",
"لقد انتهزنا الفرصة لمراجعة مشكلتك، ويمكننا ملاحظة أنك قد تواصلت معنا بشأنها من قبل. ومن ثمَّ، سنغلق تذكرة الدعم الحالية لتسهيل التواصل وتجنُّب أي التباس",
"نحن نأخذ هذه الأنواع من الادعاءات على محمل الجد وسوف نتخذ الإجراءات المناسبة مع الشريك السائق المعني",
"إذا تمت مطابقتكِ مرة أخرى، يرجى إلغاء الرحلة والتواصل معنا من خلال التطبيق",
"سنتابع الأمر مع السائق من أجل اتخاذ الإجراءات المناسبة داخلياً",
"لنمنح الركاب تجربة خالية من المتاعب حتى يتمكنوا من إجراء مشوار في أقرب وقت ممكن",
"يمكننا الردّ على أي استفسارات حول هذا الأمر في أي وقت",
"وسنتابع الأمر مع الشريك السائق المعني",


"We will be following up with Partner-driver, to try to ensure the experience you describe can't happen again.",
"We will be following up with the driver and taking the appropriate actions",
"Rest assured that we have taken the necessary internal actions.",
"already taken the appropriate action internally",
"already taken the appropriate actions internally",
"We have already taken all the appropriate actions internally.",
"to try to ensure the experience you describe can't happen again.",
"It looks like you've already raised a similar concern for this trip that our Support team has resolved.",
"We want everyone, both drivers and riders, to have a safe, respectful, and comfortable experience as stated in our Careem Rides Community Guidelines.",
"we will be taking the appropriate actions internally with the driver involved",
"-PB",
"- PB",
"-Pushback",
"-Push back",
"- Pushback",
"- Push back",
"LERT@uber.com",
"NRN"
        ]
    };

    // =========================================================================
    // RUMI ENHANCEMENT - PERSISTENT STORAGE
    // =========================================================================

    const RUMIStorage = {
        STORAGE_KEYS: {
            PROCESSED_TICKETS: 'rumi_processed_tickets',
            AUTOMATION_LOGS: 'rumi_automation_logs',
            TICKET_HISTORY: 'rumi_ticket_history',
            MONITORING_STATE: 'rumi_monitoring_state',
            SETTINGS: 'rumi_settings'
        },

        // Save processed tickets to localStorage
        saveProcessedTickets() {
            try {
                const data = {
                    processedHistory: rumiEnhancement.processedHistory,
                    pendingTickets: rumiEnhancement.pendingTickets,
                    solvedTickets: rumiEnhancement.solvedTickets,
                    rtaTickets: rumiEnhancement.rtaTickets,
                    automaticTickets: rumiEnhancement.automaticTickets,
                    manualTickets: rumiEnhancement.manualTickets,
                    processedTickets: Array.from(rumiEnhancement.processedTickets),
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem(this.STORAGE_KEYS.PROCESSED_TICKETS, JSON.stringify(data));
                RUMILogger.debug('Saved processed tickets to storage');
            } catch (error) {
                RUMILogger.error('Failed to save processed tickets', null, error);
            }
        },

        // Load processed tickets from localStorage
        loadProcessedTickets() {
            try {
                const data = localStorage.getItem(this.STORAGE_KEYS.PROCESSED_TICKETS);
                if (!data) return false;

                const parsed = JSON.parse(data);

                // Restore processed ticket data
                rumiEnhancement.processedHistory = parsed.processedHistory || [];
                rumiEnhancement.pendingTickets = parsed.pendingTickets || [];
                rumiEnhancement.solvedTickets = parsed.solvedTickets || [];
                rumiEnhancement.rtaTickets = parsed.rtaTickets || [];
                rumiEnhancement.automaticTickets = parsed.automaticTickets || {pending: [], solved: [], rta: []};
                rumiEnhancement.manualTickets = parsed.manualTickets || {pending: [], solved: [], rta: []};
                rumiEnhancement.processedTickets = new Set(parsed.processedTickets || []);

                const ticketCount = rumiEnhancement.processedHistory.length;
                RUMILogger.info(`Restored ${ticketCount} processed tickets from storage`);
                return true;
            } catch (error) {
                RUMILogger.error('Failed to load processed tickets', null, error);
                return false;
            }
        },

        // Save automation logs to localStorage
        saveAutomationLogs() {
            try {
                const data = {
                    logs: rumiEnhancement.automationLogs.slice(0, 200), // Keep last 200 logs
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem(this.STORAGE_KEYS.AUTOMATION_LOGS, JSON.stringify(data));
            } catch (error) {
                RUMILogger.error('Failed to save automation logs', null, error);
            }
        },

        // Load automation logs from localStorage
        loadAutomationLogs() {
            try {
                const data = localStorage.getItem(this.STORAGE_KEYS.AUTOMATION_LOGS);
                if (!data) return false;

                const parsed = JSON.parse(data);
                rumiEnhancement.automationLogs = parsed.logs || [];

                RUMILogger.debug(`Restored ${rumiEnhancement.automationLogs.length} log entries from storage`);
                return true;
            } catch (error) {
                RUMILogger.error('Failed to load automation logs', null, error);
                return false;
            }
        },

        // Save ticket status history
        saveTicketHistory() {
            try {
                const historyArray = Array.from(rumiEnhancement.ticketStatusHistory.entries());
                const data = {
                    history: historyArray,
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem(this.STORAGE_KEYS.TICKET_HISTORY, JSON.stringify(data));
            } catch (error) {
                RUMILogger.error('Failed to save ticket history', null, error);
            }
        },

        // Load ticket status history
        loadTicketHistory() {
            try {
                const data = localStorage.getItem(this.STORAGE_KEYS.TICKET_HISTORY);
                if (!data) return false;

                const parsed = JSON.parse(data);
                rumiEnhancement.ticketStatusHistory = new Map(parsed.history || []);

                RUMILogger.debug(`Restored ${rumiEnhancement.ticketStatusHistory.size} ticket status entries from storage`);
                return true;
            } catch (error) {
                RUMILogger.error('Failed to load ticket history', null, error);
                return false;
            }
        },

        // Save monitoring state and settings
        saveMonitoringState() {
            try {
                const data = {
                    selectedViews: Array.from(rumiEnhancement.selectedViews),
                    isDryRun: rumiEnhancement.isDryRun,
                    dryRunModes: rumiEnhancement.dryRunModes,
                    activeTab: rumiEnhancement.activeTab,
                    currentLogLevel: rumiEnhancement.currentLogLevel,
                    operationModes: rumiEnhancement.operationModes,
                    enabledPendingPhrases: rumiEnhancement.enabledPendingPhrases,
                    enabledSolvedPhrases: rumiEnhancement.enabledSolvedPhrases,
                    checkInterval: rumiEnhancement.config.CHECK_INTERVAL,
                    monitoringStats: rumiEnhancement.monitoringStats,
                    lastSaved: new Date().toISOString()
                };
                localStorage.setItem(this.STORAGE_KEYS.MONITORING_STATE, JSON.stringify(data));
            } catch (error) {
                RUMILogger.error('Failed to save monitoring state', null, error);
            }
        },

        // Load monitoring state and settings
        loadMonitoringState() {
            try {
                const data = localStorage.getItem(this.STORAGE_KEYS.MONITORING_STATE);
                if (!data) return false;

                const parsed = JSON.parse(data);

                // Restore state
                rumiEnhancement.selectedViews = new Set(parsed.selectedViews || []);
                rumiEnhancement.isDryRun = parsed.isDryRun !== undefined ? parsed.isDryRun : true;
                rumiEnhancement.dryRunModes = {
                    automatic: parsed.dryRunModes?.automatic !== undefined ? parsed.dryRunModes.automatic : true,
                    manual: parsed.dryRunModes?.manual !== undefined ? parsed.dryRunModes.manual : true
                };
                rumiEnhancement.activeTab = parsed.activeTab || 'automatic';
                rumiEnhancement.currentLogLevel = parsed.currentLogLevel || 2;
                rumiEnhancement.operationModes = { ...rumiEnhancement.operationModes, ...parsed.operationModes };

                // Restore phrase enable/disable arrays
                if (parsed.enabledPendingPhrases) {
                    rumiEnhancement.enabledPendingPhrases = parsed.enabledPendingPhrases;
                }
                if (parsed.enabledSolvedPhrases) {
                    rumiEnhancement.enabledSolvedPhrases = parsed.enabledSolvedPhrases;
                }

                if (parsed.checkInterval) {
                    rumiEnhancement.config.CHECK_INTERVAL = parsed.checkInterval;
                }

                // Restore monitoring statistics
                if (parsed.monitoringStats) {
                    rumiEnhancement.monitoringStats = {
                        ...rumiEnhancement.monitoringStats,
                        ...parsed.monitoringStats
                    };
                }

                RUMILogger.debug('Restored monitoring state from storage');
                return true;
            } catch (error) {
                RUMILogger.error('Failed to load monitoring state', null, error);
                return false;
            }
        },

        // Save all data
        saveAll() {
            this.saveProcessedTickets();
            this.saveAutomationLogs();
            this.saveTicketHistory();
            this.saveMonitoringState();
        },

        // Load all data
        loadAll() {
            this.loadProcessedTickets();
            this.loadAutomationLogs();
            this.loadTicketHistory();
            this.loadMonitoringState();
        },

        // Clear old data (older than specified days)
        clearOldData(daysToKeep = 7) {
            try {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

                // Clean processed tickets
                rumiEnhancement.processedHistory = rumiEnhancement.processedHistory.filter(ticket =>
                    new Date(ticket.timestamp) > cutoffDate
                );
                rumiEnhancement.pendingTickets = rumiEnhancement.pendingTickets.filter(ticket =>
                    new Date(ticket.timestamp) > cutoffDate
                );
                rumiEnhancement.solvedTickets = rumiEnhancement.solvedTickets.filter(ticket =>
                    new Date(ticket.timestamp) > cutoffDate
                );
                rumiEnhancement.rtaTickets = rumiEnhancement.rtaTickets.filter(ticket =>
                    new Date(ticket.timestamp) > cutoffDate
                );

                // Clean logs
                rumiEnhancement.automationLogs = rumiEnhancement.automationLogs.filter(log =>
                    new Date(log.timestamp) > cutoffDate
                );

                // Clean ticket history
                for (const [ticketId, history] of rumiEnhancement.ticketStatusHistory.entries()) {
                    if (new Date(history.lastProcessed) <= cutoffDate) {
                        rumiEnhancement.ticketStatusHistory.delete(ticketId);
                    }
                }

                this.saveAll();
                RUMILogger.info(`Cleaned data older than ${daysToKeep} days`);
            } catch (error) {
                RUMILogger.error('Failed to clean old data', null, error);
            }
        },

        // Clear all stored data
        clearAll() {
            try {
                Object.values(this.STORAGE_KEYS).forEach(key => {
                    localStorage.removeItem(key);
                });
                RUMILogger.info('Cleared all stored data');
            } catch (error) {
                RUMILogger.error('Failed to clear stored data', null, error);
            }
        },

        // Remove duplicates from processed tickets
        deduplicateProcessedTickets() {
            try {
                // Deduplicate pending tickets
                const uniquePending = [];
                const seenPendingIds = new Set();
                for (const ticket of rumiEnhancement.pendingTickets) {
                    if (!seenPendingIds.has(ticket.id)) {
                        seenPendingIds.add(ticket.id);
                        uniquePending.push(ticket);
                    }
                }

                // Deduplicate solved tickets
                const uniqueSolved = [];
                const seenSolvedIds = new Set();
                for (const ticket of rumiEnhancement.solvedTickets) {
                    if (!seenSolvedIds.has(ticket.id)) {
                        seenSolvedIds.add(ticket.id);
                        uniqueSolved.push(ticket);
                    }
                }

                // Deduplicate RTA tickets
                const uniqueRta = [];
                const seenRtaIds = new Set();
                for (const ticket of rumiEnhancement.rtaTickets) {
                    if (!seenRtaIds.has(ticket.id)) {
                        seenRtaIds.add(ticket.id);
                        uniqueRta.push(ticket);
                    }
                }

                const beforeCounts = {
                    pending: rumiEnhancement.pendingTickets.length,
                    solved: rumiEnhancement.solvedTickets.length,
                    rta: rumiEnhancement.rtaTickets.length
                };

                // Replace with deduplicated arrays
                rumiEnhancement.pendingTickets = uniquePending;
                rumiEnhancement.solvedTickets = uniqueSolved;
                rumiEnhancement.rtaTickets = uniqueRta;

                const afterCounts = {
                    pending: uniquePending.length,
                    solved: uniqueSolved.length,
                    rta: uniqueRta.length
                };

                // Save the cleaned data
                this.saveProcessedTickets();

                RUMILogger.info(`Removed duplicates: Pending ${beforeCounts.pending}→${afterCounts.pending}, Solved ${beforeCounts.solved}→${afterCounts.solved}, RTA ${beforeCounts.rta}→${afterCounts.rta}`);

                return {
                    before: beforeCounts,
                    after: afterCounts
                };
            } catch (error) {
                RUMILogger.error('Failed to deduplicate processed tickets', null, error);
                return null;
            }
        }
    };

    // Configuration object for timing and cache management
    const config = {
        timing: {
            cacheMaxAge: 5000
        }
    };

    // Function to load field visibility state from localStorage
    function loadFieldVisibilityState() {
        const savedState = localStorage.getItem('zendesk_field_visibility_state');
        if (savedState && (savedState === 'all' || savedState === 'minimal')) {
            fieldVisibilityState = savedState;
            console.log(`🔐 Field visibility state loaded from storage: ${fieldVisibilityState}`);
        } else {
            fieldVisibilityState = 'all'; // Default state
            console.log(`🔐 Using default field visibility state: ${fieldVisibilityState}`);
        }
    }

    // Function to save field visibility state to localStorage
    function saveFieldVisibilityState() {
        localStorage.setItem('zendesk_field_visibility_state', fieldVisibilityState);
        console.log(`💾 Field visibility state saved: ${fieldVisibilityState}`);
    }

    // Function to apply the current field visibility state to forms
    function applyFieldVisibilityState(retryCount = 0) {
        // Enhanced form detection for both old and new structures
        let allForms = DOMCache.get('section.grid-ticket-fields-panel', true, 2000);

        // If no forms found with the old selector, try new selectors
        if (allForms.length === 0) {
            const formSelectors = [
                'section[class*="ticket-fields"]',
                '[data-test-id*="TicketFieldsPane"]',
                '.ticket_fields',
                'form',
                '[class*="form"]',
                'div[class*="ticket-field"]'
            ];
            
            for (const selector of formSelectors) {
                allForms = DOMCache.get(selector, false, 1000);
                if (allForms.length > 0) {
                    console.log(`📋 Found forms using selector: ${selector}`);
                    break;
                }
            }
        }

        if (allForms.length === 0) {
            if (retryCount < 3) {
                console.warn(`⚠️ No forms found for field visibility control. Retrying in 1 second... (attempt ${retryCount + 1}/3)`);
                setTimeout(() => applyFieldVisibilityState(retryCount + 1), 1000);
                return;
            } else {
                console.warn('⚠️ No forms found for field visibility control after 3 attempts. Fields may be loading dynamically or structure has changed.');
                return;
            }
        }

        console.log(`🔄 Applying field visibility state: ${fieldVisibilityState}`);

        requestAnimationFrame(() => {
            allForms.forEach(form => {
                if (!form || !form.children || !form.isConnected) return;

                // Enhanced field detection to handle both old and new structures
                // Start with a broad search and then filter out system fields
                const allPossibleFields = Array.from(form.querySelectorAll('[data-garden-id="forms.field"], .StyledField-sc-12gzfsu-0, [class*="field"], [data-test-id*="field"], div:has(label)'));
                
                const fields = [];
                allPossibleFields.forEach(field => {
                    try {
                        // Must have a label and be connected
                        if (field.nodeType !== Node.ELEMENT_NODE || 
                            !field.isConnected || 
                            !field.querySelector('label')) {
                            return;
                        }
                        
                        // Skip system fields (Requester, Assignee, CCs)
                        if (isSystemField(field)) {
                            return;
                        }
                        
                        // Skip duplicates
                        if (fields.includes(field)) {
                            return;
                        }
                        
                        fields.push(field);
                    } catch (e) {
                        console.debug('Error processing field:', field, e);
                    }
                });

                // Debug logging
                if (rumiEnhancement.isMonitoring) {
                    console.log(`🔍 Found ${allPossibleFields.length} total possible fields, ${fields.length} ticket fields (excluding system fields):`);
                    console.log(`📋 Ticket fields:`, fields.map(f => {
                        const label = f.querySelector('label');
                        return label ? label.textContent.trim() : 'No label';
                    }));
                    
                    // Also log system fields that were excluded
                    const systemFields = allPossibleFields.filter(f => f.querySelector('label') && isSystemField(f));
                    if (systemFields.length > 0) {
                        console.log(`🚫 Excluded ${systemFields.length} system fields (always visible):`, systemFields.map(f => {
                            const label = f.querySelector('label');
                            return label ? label.textContent.trim() : 'No label';
                        }));
                    }
                    
                    // Log which fields will be hidden vs shown in minimal mode
                    if (fieldVisibilityState === 'minimal') {
                        const fieldsToShow = fields.filter(f => isTargetField(f));
                        const fieldsToHide = fields.filter(f => !isTargetField(f));
                        console.log(`✅ Will SHOW ${fieldsToShow.length} minimal fields:`, fieldsToShow.map(f => f.querySelector('label')?.textContent.trim()));
                        console.log(`❌ Will HIDE ${fieldsToHide.length} non-minimal fields:`, fieldsToHide.map(f => f.querySelector('label')?.textContent.trim()));
                    }
                    
                    // Log current visibility state
                    console.log(`👁️ Current field visibility state: ${fieldVisibilityState}`);
                }

                // Batch DOM operations
                const fieldsToHide = [];
                const fieldsToShow = [];

                fields.forEach(field => {
                    try {
                        if (fieldVisibilityState === 'all') {
                            // Show all fields
                            fieldsToShow.push(field);
                        } else if (isTargetField(field)) {
                            // This is a target field for minimal state, show it
                            fieldsToShow.push(field);
                        } else {
                            // This is not a target field for minimal state, hide it
                            fieldsToHide.push(field);
                        }
                    } catch (e) {
                        console.warn('Error processing field:', field, e);
                    }
                });

                // Apply changes in batches to minimize reflows
                fieldsToHide.forEach(field => {
                    try {
                        field.classList.add('hidden-form-field');
                    } catch (e) {
                        console.warn('Error hiding field:', field, e);
                    }
                });
                fieldsToShow.forEach(field => {
                    try {
                        field.classList.remove('hidden-form-field');
                    } catch (e) {
                        console.warn('Error showing field:', field, e);
                    }
                });

                // Log summary
                if (rumiEnhancement.isMonitoring) {
                    console.log(`👁️ Field visibility applied: ${fieldsToShow.length} shown, ${fieldsToHide.length} hidden (state: ${fieldVisibilityState})`);
                }
            });

            // Update button state to reflect current state
            updateToggleButtonState();
        });
    }

    // Enhanced DOM cache system
    const DOMCache = {
        _staticCache: new Map(),
        _volatileCache: new Map(),

        get(selector, isStatic = false, maxAge = null) {
            const cache = isStatic ? this._staticCache : this._volatileCache;
            const defaultMaxAge = isStatic ? config.timing.cacheMaxAge : 1000;
            const actualMaxAge = maxAge || defaultMaxAge;

            const now = Date.now();
            const cached = cache.get(selector);

            if (cached && (now - cached.timestamp) < actualMaxAge) {
                return cached.elements;
            }

            const elements = document.querySelectorAll(selector);
            cache.set(selector, { elements, timestamp: now });

            this._cleanup(cache, actualMaxAge);
            return elements;
        },

        clear() {
            this._staticCache.clear();
            this._volatileCache.clear();
        },

        _cleanup(cache, maxAge) {
            if (cache.size > 50) {
                const now = Date.now();
                for (const [key, value] of cache.entries()) {
                    if ((now - value.timestamp) > maxAge * 2) {
                        cache.delete(key);
                    }
                }
            }
        }
    };

    // CSS injection for RUMI button and text input
    function injectCSS() {
        if (document.getElementById('rumi-styles')) return;

        const style = document.createElement('style');
        style.id = 'rumi-styles';
        style.textContent = `
            /* RUMI button icon styles */
            .rumi-icon svg {
                width: 16px !important;
                height: 16px !important;
                display: block !important;
            }

            /* Duplicate button icon styles */
            .duplicate-icon svg {
                width: 16px !important;
                height: 16px !important;
                display: block !important;
            }

            .sc-ymabb7-1.fTDEYw {
                display: inline-flex !important;
                align-items: center !important;
            }

            /* Text input styles */
            .rumi-text-input {
                position: fixed;
                width: 30px;
                height: 20px;
                font-size: 12px;
                border: 1px solid #ccc;
                border-radius: 3px;
                padding: 2px;
                z-index: 1000;
                background: white;
            }

            /* Field visibility styles */
            .hidden-form-field {
                display: none !important;
            }
            .form-toggle-icon {
                width: 26px;
                height: 26px;
            }

            /* Views toggle functionality styles */
            .hidden-view-item {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                height: 0 !important;
                overflow: hidden !important;
                margin: 0 !important;
                padding: 0 !important;
            }

            /* Views toggle button protection */
            .views-toggle-btn,
            #views-toggle-button,
            #views-toggle-wrapper {
                pointer-events: auto !important;
                visibility: visible !important;
                opacity: 1 !important;
                display: inline-block !important;
                position: relative !important;
                z-index: 100 !important;
            }

            #views-header-left-container {
                pointer-events: auto !important;
                visibility: visible !important;
                display: flex !important;
            }

            /* Navigation button container styling */
            .custom-nav-section {
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                width: 100% !important;
            }

            .nav-list-item {
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                width: 100% !important;
            }

            /* Center the button content */
            .form-toggle-icon {
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                width: 100% !important;
                text-align: center !important;
            }

            /* Navigation separator styling */
            .nav-separator {
                height: 2px;
                background-color: rgba(47, 57, 65, 0.24);
                margin: 12px 16px;
                width: calc(100% - 32px);
                border-radius: 1px;
            }

            /* Toast notification styling for export notifications */

            /* RUMI Enhancement Control Panel Styles - Professional Admin Interface */
            .rumi-enhancement-overlay {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 100% !important;
                background: rgba(0,0,0,0.5) !important;
                z-index: 2147483647 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            .rumi-enhancement-overlay.rumi-hidden {
                display: none !important;
            }

            .rumi-enhancement-panel {
                background: #F5F5F5 !important;
                color: #333333 !important;
                padding: 0 !important;
                border-radius: 2px !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
                max-width: 900px !important;
                max-height: 90vh !important;
                overflow-y: auto !important;
                width: 95% !important;
                font-family: Arial, Helvetica, sans-serif !important;
                border: 1px solid #E0E0E0 !important;
            }

            .rumi-enhancement-panel h2 {
                color: #333333 !important;
                font-size: 14px !important;
                margin: 0 !important;
                font-weight: bold !important;
                text-shadow: none !important;
            }

            .rumi-enhancement-panel h3 {
                color: #333333 !important;
                font-size: 14px !important;
                margin: 0 0 12px 0 !important;
                font-weight: bold !important;
                text-shadow: none !important;
            }

            .rumi-enhancement-panel h4 {
                color: #666666 !important;
                font-size: 13px !important;
                margin: 0 0 8px 0 !important;
                font-weight: bold !important;
            }

            .rumi-enhancement-button {
                padding: 6px 12px !important;
                border: 1px solid #CCCCCC !important;
                border-radius: 2px !important;
                background: white !important;
                color: #333333 !important;
                cursor: pointer !important;
                margin-right: 8px !important;
                margin-bottom: 4px !important;
                font-size: 13px !important;
                font-family: Arial, Helvetica, sans-serif !important;
                transition: none !important;
                box-shadow: none !important;
            }

            .rumi-enhancement-button-primary {
                background: #0066CC !important;
                color: white !important;
                border-color: #0066CC !important;
                box-shadow: none !important;
            }

            .rumi-enhancement-button-danger {
                background: #DC3545 !important;
                color: white !important;
                border-color: #DC3545 !important;
                box-shadow: none !important;
            }

            .rumi-enhancement-button:hover {
                background: #F0F0F0 !important;
                transform: none !important;
                box-shadow: none !important;
            }

            .rumi-enhancement-button-primary:hover {
                background: #0052A3 !important;
            }

            .rumi-enhancement-button-danger:hover {
                background: #C82333 !important;
            }

            .rumi-enhancement-status-active {
                color: #28A745 !important;
                font-weight: bold !important;
                text-shadow: none !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-status-inactive {
                color: #DC3545 !important;
                font-weight: bold !important;
                text-shadow: none !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-section {
                margin-bottom: 16px !important;
                border-bottom: none !important;
                padding: 16px !important;
                background: white !important;
                border-radius: 2px !important;
                border: 1px solid #E0E0E0 !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
            }

            .rumi-enhancement-section:last-child {
                margin-bottom: 0 !important;
            }

            .rumi-processed-ticket-item {
                margin-bottom: 8px !important;
                padding: 8px 12px !important;
                background: #FAFAFA !important;
                border-left: 3px solid #0066CC !important;
                font-size: 13px !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                border: 1px solid #E0E0E0 !important;
                border-left: 3px solid #0066CC !important;
            }

            .rumi-enhancement-panel input[type="text"],
            .rumi-enhancement-panel input[type="range"] {
                background: white !important;
                border: 1px solid #CCCCCC !important;
                color: #333333 !important;
                border-radius: 2px !important;
                padding: 6px 8px !important;
                font-family: Arial, Helvetica, sans-serif !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-panel input[type="checkbox"] {
                accent-color: #0066CC !important;
                transform: none !important;
            }

            .rumi-enhancement-panel label {
                color: #666666 !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-panel details {
                border: 1px solid #E0E0E0 !important;
                border-radius: 2px !important;
                padding: 12px !important;
                background: white !important;
            }

            .rumi-enhancement-panel summary {
                color: #333333 !important;
                font-weight: bold !important;
                cursor: pointer !important;
                padding: 8px !important;
                border-radius: 0 !important;
                transition: none !important;
                font-size: 13px !important;
            }

            .rumi-enhancement-panel summary:hover {
                background: #F0F0F0 !important;
            }

            /* RUMI Enhancement View Selection Styles - Table Format */
            .rumi-view-grid {
                display: block !important;
                max-height: 400px !important;
                overflow-y: auto !important;
                border: 1px solid #E0E0E0 !important;
                border-radius: 2px !important;
                padding: 0 !important;
                background: white !important;
            }

            .rumi-view-group {
                margin-bottom: 0 !important;
            }

            .rumi-view-group-header {
                color: #666666 !important;
                font-size: 11px !important;
                font-weight: bold !important;
                margin: 0 !important;
                padding: 8px 12px !important;
                background: #F0F0F0 !important;
                border-radius: 0 !important;
                border-left: none !important;
                text-shadow: none !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
                border-bottom: 1px solid #E0E0E0 !important;
            }

            .rumi-view-item {
                display: flex !important;
                align-items: center !important;
                padding: 8px 12px !important;
                border: none !important;
                border-radius: 0 !important;
                background: white !important;
                cursor: pointer !important;
                transition: none !important;
                font-size: 13px !important;
                margin-bottom: 0 !important;
                border-bottom: 1px solid #F0F0F0 !important;
            }

            .rumi-view-item:nth-child(even) {
                background: #FAFAFA !important;
            }

            .rumi-view-item:hover {
                border-color: transparent !important;
                background: #E8F4FD !important;
                box-shadow: none !important;
                transform: none !important;
            }

            .rumi-view-item.selected {
                border-color: transparent !important;
                background: #D1ECF1 !important;
                box-shadow: none !important;
            }

            .rumi-view-checkbox {
                margin-right: 12px !important;
                accent-color: #0066CC !important;
                transform: none !important;
            }

            /* Tab Styles */
            .rumi-tabs {
                border: 1px solid #E0E0E0 !important;
                border-radius: 4px !important;
                background: white !important;
            }

            .rumi-tab-headers {
                display: flex !important;
                border-bottom: 1px solid #E0E0E0 !important;
                background: #F8F9FA !important;
                border-radius: 4px 4px 0 0 !important;
            }

            .rumi-tab-header {
                flex: 1 !important;
                padding: 10px 16px !important;
                border: none !important;
                background: transparent !important;
                cursor: pointer !important;
                font-size: 13px !important;
                font-weight: 500 !important;
                color: #666 !important;
                border-bottom: 2px solid transparent !important;
                transition: all 0.2s ease !important;
            }

            .rumi-tab-header:hover {
                background: #E9ECEF !important;
                color: #333 !important;
            }

            .rumi-tab-header.active {
                background: white !important;
                color: #0066CC !important;
                border-bottom-color: #0066CC !important;
                margin-bottom: -1px !important;
            }

            .rumi-tab-content {
                position: relative !important;
            }

            .rumi-tab-panel {
                display: none !important;
                padding: 16px !important;
            }

            .rumi-tab-panel.active {
                display: block !important;
            }

            /* Result Card Styles */
            .rumi-result-card:hover {
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
                border-color: #0066CC !important;
            }

            .rumi-result-card.selected {
                border-color: #0066CC !important;
                box-shadow: 0 2px 8px rgba(0,102,204,0.2) !important;
            }

            .rumi-view-info {
                flex: 1 !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
            }

            .rumi-view-title {
                font-weight: normal !important;
                color: #333333 !important;
                margin-bottom: 0 !important;
                font-size: 13px !important;
            }


            .rumi-view-selection-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                margin-bottom: 12px !important;
            }

            .rumi-view-selection-actions {
                display: flex !important;
                gap: 8px !important;
            }

            /* Top Bar Styles */
            .rumi-enhancement-top-bar {
                background: white !important;
                border-bottom: 1px solid #E0E0E0 !important;
                padding: 12px 16px !important;
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                height: 40px !important;
                box-sizing: border-box !important;
            }

            /* Main Tab Navigation */
            .rumi-main-tabs {
                display: flex !important;
                background: #f8f9fa !important;
                border-bottom: 1px solid #E0E0E0 !important;
                margin: 0 !important;
                padding: 0 !important;
            }

            .rumi-main-tab {
                flex: 1 !important;
                background: transparent !important;
                border: none !important;
                padding: 12px 16px !important;
                cursor: pointer !important;
                font-size: 13px !important;
                font-weight: 500 !important;
                color: #666666 !important;
                border-bottom: 3px solid transparent !important;
                transition: all 0.2s ease !important;
            }

            .rumi-main-tab:hover {
                background: #e9ecef !important;
                color: #333333 !important;
            }

            .rumi-main-tab.active {
                color: #0066CC !important;
                background: white !important;
                border-bottom-color: #0066CC !important;
            }

            /* Main Tab Content */
            .rumi-main-tab-content {
                position: relative !important;
            }

            .rumi-main-tab-panel {
                display: none !important;
            }

            .rumi-main-tab-panel.active {
                display: block !important;
            }

            /* Metrics Row */
            .rumi-metrics-row {
                display: flex !important;
                gap: 16px !important;
                margin-bottom: 16px !important;
            }

            .rumi-metric-box {
                flex: 1 !important;
                background: white !important;
                border: 1px solid #E0E0E0 !important;
                border-radius: 2px !important;
                padding: 12px !important;
                text-align: center !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
            }

            .rumi-metric-value {
                font-size: 18px !important;
                font-weight: bold !important;
                color: #333333 !important;
                display: block !important;
                margin-bottom: 4px !important;
            }

            .rumi-metric-label {
                font-size: 11px !important;
                color: #666666 !important;
                text-transform: uppercase !important;
                letter-spacing: 0.5px !important;
            }

            /* Control Panel Horizontal Layout */
            .rumi-control-panel {
                display: flex !important;
                align-items: center !important;
                gap: 16px !important;
                margin-bottom: 16px !important;
            }

            .rumi-status-indicator {
                display: flex !important;
                align-items: center !important;
                gap: 6px !important;
            }

            .rumi-status-dot {
                width: 8px !important;
                height: 8px !important;
                border-radius: 50% !important;
                display: inline-block !important;
            }

            .rumi-status-dot.active {
                background: #28A745 !important;
            }

            .rumi-status-dot.inactive {
                background: #DC3545 !important;
            }

            /* CSV Export Button Styles */
            .rumi-view-actions {
                opacity: 1 !important;
            }

            .rumi-csv-download-btn {
                min-width: 28px !important;
                height: 24px !important;
                padding: 4px !important;
                margin-right: 0 !important;
                margin-bottom: 0 !important;
                font-size: 14px !important;
                line-height: 1 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            .rumi-csv-download-btn svg {
                width: 16px !important;
                height: 16px !important;
                display: block !important;
            }

            /* Manual Export Views Styles - Simplified */
            .rumi-manual-export-simple {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .rumi-export-simple-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 12px;
                background: #F8F9FA;
                border: 1px solid #E0E0E0;
                border-radius: 3px;
            }

            .rumi-export-view-name {
                font-size: 12px;
                color: #495057;
                flex: 1;
            }

            .rumi-manual-export-btn {
                min-width: 28px !important;
                height: 24px !important;
                padding: 4px !important;
                margin-left: 8px !important;
                font-size: 14px !important;
                line-height: 1 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            .rumi-manual-export-btn svg {
                width: 16px !important;
                height: 16px !important;
                display: block !important;
            }

            /* Log Entry Styles */
            .rumi-log-entry {
                display: flex !important;
                align-items: flex-start !important;
                gap: 8px !important;
                padding: 4px 0 !important;
                border-bottom: 1px solid #F0F0F0 !important;
                font-size: 11px !important;
                line-height: 1.3 !important;
            }

            .rumi-log-entry:last-child {
                border-bottom: none !important;
            }

            .rumi-log-time {
                color: #666 !important;
                min-width: 60px !important;
                font-size: 10px !important;
            }

            .rumi-log-level {
                min-width: 40px !important;
                font-weight: bold !important;
                font-size: 10px !important;
                text-align: center !important;
                padding: 1px 4px !important;
                border-radius: 2px !important;
            }

            .rumi-log-error .rumi-log-level {
                background: #ffebee !important;
                color: #c62828 !important;
            }

            .rumi-log-warn .rumi-log-level {
                background: #fff8e1 !important;
                color: #f57f17 !important;
            }

            .rumi-log-info .rumi-log-level {
                background: #e3f2fd !n