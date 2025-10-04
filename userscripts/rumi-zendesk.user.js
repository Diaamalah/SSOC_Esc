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

    // ... existing code ...

})();
