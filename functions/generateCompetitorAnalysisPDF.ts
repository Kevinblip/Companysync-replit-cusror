import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let y = 20;

    // Title
    doc.setFontSize(24);
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold');
    doc.text('AI Receptionist: Competitive Analysis', margin, y);
    
    y += 10;
    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text('Jobber Receptionist vs JobNimbus AssistAI vs Our Platform', margin, y);
    
    y += 15;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);

    // Executive Summary
    y += 10;
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('Executive Summary', margin, y);
    
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const summary = 'We are 85% feature-complete compared to Jobber and JobNimbus. Adding 3 critical features (live call transfer, emergency detection, and performance dashboard) will make us definitively better. We have 7 unique advantages they cannot match.';
    const summaryLines = doc.splitTextToSize(summary, pageWidth - 2 * margin);
    summaryLines.forEach(line => {
      doc.text(line, margin, y);
      y += 5;
    });

    // Key Stats
    y += 5;
    doc.setFillColor(239, 246, 255);
    doc.rect(margin, y, pageWidth - 2 * margin, 25, 'F');
    
    y += 8;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('85% Feature Parity', margin + 5, y);
    doc.text('3 Critical Gaps', margin + 70, y);
    doc.text('7 Unique Advantages', margin + 135, y);
    
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('with competitors', margin + 5, y);
    doc.text('to close', margin + 70, y);
    doc.text('we have', margin + 135, y);

    // New page for competitor features
    doc.addPage();
    y = 20;

    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('Competitor Feature Analysis', margin, y);

    // Jobber Features
    y += 10;
    doc.setFontSize(12);
    doc.setTextColor(34, 139, 34);
    doc.text('Jobber Receptionist', margin, y);
    
    y += 7;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'normal');

    const jobberFeatures = [
      '✓ 24/7 AI call & text answering',
      '✓ Answer questions about services',
      '✓ Schedule visits and appointments',
      '✓ Create work requests',
      '✓ Take messages with conversation summary',
      '✓ Transfer calls when needed',
      '✓ Emergency detection and routing',
      '✓ Customizable greeting (Professional/Casual/Brief)',
      '✓ Real-time monitoring dashboard',
      '✓ Native CRM integration',
      '✓ Call recording',
      '✓ SMS handling'
    ];

    jobberFeatures.forEach(feature => {
      doc.text(feature, margin + 5, y);
      y += 5;
    });

    // JobNimbus Features
    y += 8;
    doc.setFontSize(12);
    doc.setTextColor(37, 99, 235);
    doc.setFont('helvetica', 'bold');
    doc.text('JobNimbus AssistAI', margin, y);
    
    y += 7;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'normal');

    const jobnimbusFeatures = [
      '✓ 95%+ call answer rate 24/7',
      '✓ Direct calendar booking',
      '✓ 50-70% faster lead-to-job conversion',
      '✓ $0.15/min usage-based pricing',
      '✓ Zero staff overhead',
      '✓ Learns from business information',
      '✓ Lead capture automation',
      '✓ Performance metrics dashboard'
    ];

    jobnimbusFeatures.forEach(feature => {
      doc.text(feature, margin + 5, y);
      y += 5;
    });

    // New page for our features
    doc.addPage();
    y = 20;

    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('Our Current Features', margin, y);

    y += 10;
    doc.setFontSize(12);
    doc.setTextColor(147, 51, 234);
    doc.text('What We Have (Production)', margin, y);
    
    y += 7;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'normal');

    const ourFeatures = [
      '✓ 24/7 AI call answering (Sarah AI)',
      '✓ 24/7 SMS handling',
      '✓ Answer questions (trained on company data)',
      '✓ Schedule appointments (Google Calendar)',
      '✓ Create leads automatically',
      '✓ Create tasks for team',
      '✓ Customizable AI personality',
      '✓ Call recording',
      '✓ Call transcription',
      '✓ Native CRM integration',
      '✓ Workflow automation',
      '✓ Proactive follow-ups'
    ];

    ourFeatures.forEach(feature => {
      doc.text(feature, margin + 5, y);
      y += 5;
    });

    y += 5;
    doc.setFontSize(12);
    doc.setTextColor(220, 38, 38);
    doc.setFont('helvetica', 'bold');
    doc.text('Missing Features (Critical Gaps)', margin, y);
    
    y += 7;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'normal');

    const missingFeatures = [
      '✗ Real-time call monitoring dashboard',
      '✗ Call transfer to staff',
      '✗ Emergency detection & priority routing',
      '✗ Dedicated performance metrics dashboard',
      '✗ Sentiment analysis',
      '✗ Multi-language support'
    ];

    missingFeatures.forEach(feature => {
      doc.text(feature, margin + 5, y);
      y += 5;
    });

    // New page for enhancements
    doc.addPage();
    y = 20;

    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('Priority Enhancements Roadmap', margin, y);

    y += 10;
    doc.setFillColor(254, 226, 226);
    doc.rect(margin, y, pageWidth - 2 * margin, 8, 'F');
    y += 6;
    doc.setFontSize(11);
    doc.setTextColor(153, 27, 27);
    doc.text('HIGH PRIORITY (30 days)', margin + 5, y);

    y += 8;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'normal');

    const highPriority = [
      { name: 'Live Call Dashboard', desc: 'Real-time monitoring of active calls and SMS with agent status' },
      { name: 'Intelligent Call Transfer', desc: 'Detect urgency/complexity and transfer to human with context' },
      { name: 'Emergency Detection', desc: 'Identify emergency keywords and immediately notify on-call staff' },
      { name: 'Post-Call SMS Follow-Up', desc: 'Auto-send summary and next steps after AI handles call' }
    ];

    highPriority.forEach(item => {
      doc.setFont('helvetica', 'bold');
      doc.text(`• ${item.name}`, margin + 5, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      const descLines = doc.splitTextToSize(item.desc, pageWidth - 2 * margin - 10);
      descLines.forEach(line => {
        doc.text(line, margin + 10, y);
        y += 4;
      });
      y += 3;
    });

    y += 5;
    doc.setFillColor(254, 243, 199);
    doc.rect(margin, y, pageWidth - 2 * margin, 8, 'F');
    y += 6;
    doc.setFontSize(11);
    doc.setTextColor(146, 64, 14);
    doc.setFont('helvetica', 'bold');
    doc.text('MEDIUM PRIORITY (60-90 days)', margin + 5, y);

    y += 8;
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'normal');

    const mediumPriority = [
      { name: 'AI Performance Dashboard', desc: 'Track answer rate, handle time, conversion, satisfaction' },
      { name: 'Sentiment Analysis', desc: 'Detect customer emotion and adjust response or escalate' },
      { name: 'Smart Call Routing', desc: 'Route by service type, customer history, staff expertise' },
      { name: 'Voicemail Auto-Response', desc: 'Transcribe voicemail, create lead, send SMS confirmation' }
    ];

    mediumPriority.forEach(item => {
      if (y > pageHeight - 30) {
        doc.addPage();
        y = 20;
      }
      doc.setFont('helvetica', 'bold');
      doc.text(`• ${item.name}`, margin + 5, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      const descLines = doc.splitTextToSize(item.desc, pageWidth - 2 * margin - 10);
      descLines.forEach(line => {
        doc.text(line, margin + 10, y);
        y += 4;
      });
      y += 3;
    });

    // New page for competitive advantages
    doc.addPage();
    y = 20;

    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('Our Competitive Advantages', margin, y);

    y += 8;
    doc.setFontSize(10);
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'normal');
    doc.text('Things we can do that competitors cannot:', margin, y);

    y += 10;
    doc.setFontSize(9);

    const advantages = [
      { icon: '🎯', name: 'Native CRM Integration', desc: 'We ARE the CRM - no data silos, instant sync, complete context' },
      { icon: '⚡', name: 'Workflow Automation', desc: 'AI triggers multi-step workflows. Competitors cannot do this.' },
      { icon: '💬', name: 'Unified Communication Hub', desc: 'Email, SMS, calls, AI all in one place' },
      { icon: '🤖', name: 'Customizable AI Personas', desc: 'Lexi (internal) and Sarah (customer-facing) with different capabilities' },
      { icon: '🏢', name: 'All-in-One Business Platform', desc: 'CRM + AI + invoicing + payments + projects. Not just call handling.' },
      { icon: '💰', name: 'Transparent Pricing', desc: 'Flat-rate or per-user vs. per-minute charges' },
      { icon: '📈', name: 'Full Lead-to-Cash Lifecycle', desc: 'AI captures lead, books, estimates, collects payment - end-to-end' }
    ];

    advantages.forEach(item => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${item.icon} ${item.name}`, margin + 5, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      const descLines = doc.splitTextToSize(item.desc, pageWidth - 2 * margin - 10);
      descLines.forEach(line => {
        doc.text(line, margin + 10, y);
        y += 4;
      });
      y += 4;
    });

    // Winning strategy
    doc.addPage();
    y = 20;

    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('The Winning Strategy', margin, y);

    y += 10;
    doc.setFillColor(220, 252, 231);
    doc.rect(margin, y, pageWidth - 2 * margin, 70, 'F');
    
    y += 8;
    doc.setFontSize(10);
    doc.setTextColor(21, 128, 61);

    const strategy = [
      { step: '1', title: 'Close Feature Gaps (Month 1)', desc: 'Add live call transfer, emergency detection, performance dashboard' },
      { step: '2', title: 'Leverage Native Advantages (Ongoing)', desc: 'Emphasize CRM integration, workflow automation, end-to-end platform' },
      { step: '3', title: 'Add Differentiators (Month 2-3)', desc: 'Sentiment analysis, multi-language, intelligent routing by expertise' },
      { step: '4', title: 'Market Position', desc: '"The only AI receptionist built INTO your CRM, not bolted ON"' }
    ];

    strategy.forEach(item => {
      doc.setFont('helvetica', 'bold');
      doc.text(`${item.step}. ${item.title}`, margin + 5, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      const descLines = doc.splitTextToSize(item.desc, pageWidth - 2 * margin - 10);
      descLines.forEach(line => {
        doc.text(line, margin + 10, y);
        y += 4;
      });
      y += 5;
    });

    y += 10;
    doc.setFillColor(239, 246, 255);
    doc.rect(margin, y, pageWidth - 2 * margin, 20, 'F');
    y += 8;
    doc.setFontSize(11);
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold');
    doc.text('Key Insight', margin + 5, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const insight = 'Competitors sell call handling as an add-on. We offer it as part of a complete business platform. That\'s the real advantage.';
    const insightLines = doc.splitTextToSize(insight, pageWidth - 2 * margin - 10);
    insightLines.forEach(line => {
      doc.text(line, margin + 5, y);
      y += 4;
    });

    // Footer on all pages
    const totalPages = doc.internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Competitive Analysis Report | ${new Date().toLocaleDateString()}`, margin, pageHeight - 10);
      doc.text(`${i}/${totalPages}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
    }

    const pdfBytes = doc.output('arraybuffer');
    const fileName = `AI-Receptionist-Competitive-Analysis-${new Date().toISOString().split('T')[0]}.pdf`;

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});