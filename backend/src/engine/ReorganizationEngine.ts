import fs from 'fs';
import path from 'path';
import os from 'os';
import { db } from '../db/index.js';
import { courses, courseModules, events, tasks, exams } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { eq } from 'drizzle-orm';

export class ReorganizationEngine {
    private canvasDir: string;
    private targetDir: string;

    constructor() {
        this.canvasDir = path.join(os.homedir(), 'Documents', 'CanvasSync');
        this.targetDir = path.join(os.homedir(), 'Documents', 'Vector_KnowledgeBase');
    }

    private ensureDir(dir: string) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private cleanTargetDir() {
        if (fs.existsSync(this.targetDir)) {
            fs.rmSync(this.targetDir, { recursive: true, force: true });
            logger.info('[REORG] Wiped previous Vector_KnowledgeBase');
        }
        this.ensureDir(this.targetDir);
    }

    private getCourseCode(folderName: string): string | null {
        const match = folderName.match(/([A-Z]{2}\d{3}[A-Z])/i);
        return match ? match[1].toUpperCase() : null;
    }

    public async reorganizeAll() {
        logger.info('[REORG] Starting 110% absolute data sweep...');
        this.cleanTargetDir();

        await this.exportSqlData();
        await this.sweepCanvasData();

        logger.info('[REORG] Finished Reorganization.');
    }

    private async exportSqlData() {
        logger.info('[REORG] Exporting SQL Data...');
        const allCourses = await db.select().from(courses);
        const allModules = await db.select().from(courseModules);
        const allEvents = await db.select().from(events);
        const allTasks = await db.select().from(tasks);
        const allExams = await db.select().from(exams);

        // Group everything by course
        for (const course of allCourses) {
            const courseCode = course.courseCode || 'GLOBAL';
            const coursePrefix = `[${courseCode}]`;

            // 1. Course Modules Schema
            const modules = allModules.filter(m => m.courseId === course.id);
            if (modules.length > 0) {
                let md = `# Course Modules for ${course.name}\n\n`;
                for (const m of modules) {
                    md += `- **${m.name}** (Code: ${m.moduleCode}): ${m.credits} credits. Grade: ${m.grade}. Exam Date: ${m.examinationDate}\n`;
                }
                fs.writeFileSync(path.join(this.targetDir, `${coursePrefix} 00_Schema - Course Modules.md`), md);
            }

            // 2. Events / Schedule Schema
            const courseEvents = allEvents.filter(e => e.courseId === course.id);
            if (courseEvents.length > 0) {
                let md = `# Schedule and Events for ${course.name}\n\n`;
                for (const e of courseEvents) {
                    md += `## ${e.title}\n`;
                    md += `- **Start**: ${new Date(e.startTime).toLocaleString()}\n`;
                    md += `- **End**: ${new Date(e.endTime).toLocaleString()}\n`;
                    md += `- **Location**: ${e.location || 'Unknown'}\n\n`;
                }
                fs.writeFileSync(path.join(this.targetDir, `${coursePrefix} 00_Schema - Events and Schedule.md`), md);
            }

            // 3. Tasks and Deadlines Schema
            const courseTasks = allTasks.filter(t => t.courseId === course.id);
            if (courseTasks.length > 0) {
                let md = `# Tasks and Deadlines for ${course.name}\n\n`;
                for (const t of courseTasks) {
                    md += `## ${t.title}\n`;
                    md += `- **Deadline**: ${new Date(t.deadline).toLocaleString()}\n`;
                    md += `- **Priority**: ${t.priorityScore}\n`;
                    md += `- **Completed**: ${t.isCompleted}\n`;
                    if (t.description) md += `- **Description**: ${t.description}\n`;
                    md += `\n`;
                }
                fs.writeFileSync(path.join(this.targetDir, `${coursePrefix} 00_Schema - Tasks and Deadlines.md`), md);
            }
        }

        // Tasks and events that are not linked to a known course (most sensor-ingested
        // items have a null courseId) would otherwise be silently dropped. Export them
        // under a GLOBAL bucket so they still reach the knowledge base.
        const knownCourseIds = new Set(allCourses.map((c) => c.id));
        const orphanTasks = allTasks.filter((t) => !t.courseId || !knownCourseIds.has(t.courseId));
        const orphanEvents = allEvents.filter((e) => !e.courseId || !knownCourseIds.has(e.courseId));

        if (orphanTasks.length > 0) {
            let md = `# Tasks and Deadlines (Unassigned / Global)\n\n`;
            for (const t of orphanTasks) {
                md += `## ${t.title}\n`;
                md += `- **Source**: ${t.source}\n`;
                md += `- **Deadline**: ${new Date(t.deadline).toLocaleString()}\n`;
                md += `- **Priority**: ${t.priorityScore}\n`;
                md += `- **Status**: ${t.status}\n`;
                if (t.description) md += `- **Description**: ${t.description}\n`;
                md += `\n`;
            }
            fs.writeFileSync(path.join(this.targetDir, `[GLOBAL] 00_Schema - Tasks and Deadlines.md`), md);
        }

        if (orphanEvents.length > 0) {
            let md = `# Schedule and Events (Unassigned / Global)\n\n`;
            for (const e of orphanEvents) {
                md += `## ${e.title}\n`;
                md += `- **Source**: ${e.source}\n`;
                md += `- **Start**: ${new Date(e.startTime).toLocaleString()}\n`;
                md += `- **End**: ${new Date(e.endTime).toLocaleString()}\n`;
                md += `- **Location**: ${e.location || 'Unknown'}\n\n`;
            }
            fs.writeFileSync(path.join(this.targetDir, `[GLOBAL] 00_Schema - Events and Schedule.md`), md);
        }

        // Exams (Ladok sometimes uses CourseCode directly)
        for (const exam of allExams) {
            const courseCode = exam.courseCode || 'GLOBAL';
            const coursePrefix = `[${courseCode}]`;
            let md = `# Exam: ${exam.title}\n`;
            md += `- **Course**: ${exam.courseName}\n`;
            md += `- **Date**: ${exam.examDate}\n`;
            md += `- **Location**: ${exam.place}\n`;
            md += `- **Status**: ${exam.signUpStatus}\n`;
            md += `- **Type**: ${exam.examType}\n`;
            md += `- **Module**: ${exam.moduleName}\n`;
            
            fs.writeFileSync(path.join(this.targetDir, `${coursePrefix} 00_Schema - Exam - ${this.sanitizeName(exam.title)}.md`), md);
        }
    }

    private sanitizeName(name: string): string {
        return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
    }

    private findAllMdFiles(dir: string): string[] {
        let results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat && stat.isDirectory()) {
                results = results.concat(this.findAllMdFiles(fullPath));
            } else if (file.endsWith('.md')) {
                results.push(fullPath);
            }
        }
        return results;
    }

    private async sweepCanvasData() {
        logger.info('[REORG] Sweeping Canvas Data...');
        if (!fs.existsSync(this.canvasDir)) return;

        const rootFolders = fs.readdirSync(this.canvasDir);
        for (const folder of rootFolders) {
            const folderPath = path.join(this.canvasDir, folder);
            if (!fs.statSync(folderPath).isDirectory()) continue;

            const courseCode = this.getCourseCode(folder) || 'GLOBAL';
            const coursePrefix = `[${courseCode}]`;
            
            const allMdFiles = this.findAllMdFiles(folderPath);
            
            // Map to generate Indexes later
            const categoryMap = new Map<string, string[]>();
            const masterIndexItems: string[] = [];

            for (const mdFile of allMdFiles) {
                // Calculate relative path inside the course folder
                // e.g. "Moduler/Section 1/Doc.md"
                const relativePath = path.relative(folderPath, mdFile);
                const parts = relativePath.split(path.sep);
                
                // If it's directly in the course root
                if (parts.length === 1) {
                    const flatName = `${coursePrefix} 00_Root - ${this.sanitizeName(parts[0])}`;
                    fs.copyFileSync(mdFile, path.join(this.targetDir, flatName));
                    continue;
                }

                // E.g. Category = 'Moduler', SubPath = 'Section 1/Doc.md'
                const category = parts[0];
                const subPath = parts.slice(1).join(' - '); // join remaining parts
                // E.g. 'Section 1 - Doc.md'
                
                // Strip .md if subPath has it, we'll append it later
                const cleanSubPath = subPath.replace(/\.md$/, '');

                const newFileName = `${coursePrefix} ${this.sanitizeName(category)} - ${this.sanitizeName(cleanSubPath)}.md`;
                const newFilePath = path.join(this.targetDir, newFileName);
                
                fs.copyFileSync(mdFile, newFilePath);

                // Track for indexes
                if (!categoryMap.has(category)) {
                    categoryMap.set(category, []);
                    masterIndexItems.push(category);
                }
                categoryMap.get(category)?.push(newFileName);
            }

            // Generate Indexes
            for (const [category, files] of categoryMap.entries()) {
                let catIndexMd = `# Index: ${category}\n\n`;
                for (const f of files) {
                    catIndexMd += `- [${f}](./${encodeURIComponent(f)})\n`;
                }
                fs.writeFileSync(path.join(this.targetDir, `${coursePrefix} ${category} - 00_Index.md`), catIndexMd);
            }

            if (masterIndexItems.length > 0) {
                let masterMd = `# Master Index for ${courseCode}\n\n`;
                for (const cat of masterIndexItems) {
                    const indexFile = `${coursePrefix} ${cat} - 00_Index.md`;
                    masterMd += `- [${cat} Index](./${encodeURIComponent(indexFile)})\n`;
                }
                fs.writeFileSync(path.join(this.targetDir, `${coursePrefix} 00_Master_Index.md`), masterMd);
            }
        }
    }
}
