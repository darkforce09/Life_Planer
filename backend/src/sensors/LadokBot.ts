import { chromium, Page, Browser } from 'playwright';
import { db } from '../db/index.js';
import { courses, courseModules, users, exams, tasks } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import { visionHealClick } from './autoHeal.js';

/**
 * Shared authentication helper — logs into Ladok via Miun IdP and returns
 * the browser + page so callers can navigate wherever they need.
 */
async function authenticate(username: string, password: string): Promise<{ browser: Browser; page: Page }> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'en-GB' });
    const page = await context.newPage();

    logger.info('[SENSOR-LADOK] Navigating to Ladok...');
    await page.goto('https://student.ladok.se/');

    logger.info('[SENSOR-LADOK] Selecting Identity Provider using direct SWAMID bypass...');
    await page.goto('https://student.ladok.se/student/login?ret=/app/studentwebb', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const currentUrl = new URL(page.url());
    const returnParam = currentUrl.searchParams.get('return');
    if (!returnParam) {
        throw new Error("Could not extract SeamlessAccess return parameter for IdP bypass.");
    }

    const bypassUrl = returnParam + '&entityID=' + encodeURIComponent('https://miunidp.miun.se/idp/shibboleth');
    await page.goto(bypassUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    logger.info('[SENSOR-LADOK] Entering credentials at Miun IdP...');
    await page.waitForSelector('#userNameInput', { state: 'visible', timeout: 15000 });
    await page.fill('#userNameInput', username);
    await page.fill('#passwordInput', password);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    logger.info('[SENSOR-LADOK] Waiting for Studentwebb Dashboard...');
    await page.waitForURL(/studentwebb/, { timeout: 45000 });

    return { browser, page };
}

export async function syncLadok(username?: string, password?: string): Promise<boolean> {
    logger.info('[SENSOR-LADOK] Starting REAL Playwright Headless Sync...');
    
    if (!username || !password) {
        logger.warn('[SENSOR-LADOK] No credentials provided.');
        return false;
    }

    const { browser, page } = await authenticate(username, password);

    try {
        // Navigate to "My Education"
        logger.info('[SENSOR-LADOK] Navigating to active courses...');
        await page.goto('https://student.ladok.se/student/app/studentwebb/min-utbildning');
        await page.waitForLoadState('networkidle');

        // Find all course links
        const courseHrefs = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links.map(l => l.href).filter(href => href.includes('/min-utbildning/kurs/'));
        });

        const uniqueCourses = [...new Set(courseHrefs)];
        logger.info(`[SENSOR-LADOK] Found ${uniqueCourses.length} courses to scrape.`);

        const userList = await db.select().from(users);
        let dbUser = userList[0];

        for (const href of uniqueCourses) {
            logger.info(`[SENSOR-LADOK] Scraping course details: ${href}`);
            await page.goto(href);
            await page.waitForLoadState('networkidle');

            // Extract all text on the course page using evaluate
            const courseData = await page.evaluate(() => {
                // This extracts the course code and name from the top header
                const headerText = document.querySelector('h1')?.innerText || '';
                const courseCodeMatch = document.body.innerText.match(/(?:Education code|Utbildningskod)\s*([A-Z0-9]+)/i);
                const courseCode = courseCodeMatch ? courseCodeMatch[1] : 'UNKNOWN';

                // Find the "Included parts" section by extracting cards
                const modules: any[] = [];
                const korts = Array.from(document.querySelectorAll('ladok-list-kort'));
                
                for (const kort of korts) {
                    const titleEl = kort.querySelector('.ladok-list-kort-header-rubrik');
                    if (!titleEl) continue;
                    const titleText = titleEl.textContent?.trim() || '';
                    
                    // Check if titleText matches the module format "Name - Code"
                    const moduleMatch = titleText.match(/(.+) - ([0-9]{4})$/);
                    if (moduleMatch) {
                        const name = moduleMatch[1].trim();
                        const moduleCode = moduleMatch[2].trim();
                        
                        const subRubrikEl = kort.querySelector('.ladok-list-kort-header-sub-rubrik');
                        const credits = subRubrikEl ? subRubrikEl.textContent?.trim() : '';
                        
                        const badgeEl = kort.querySelector('ladok-betygs-badge .badge');
                        const grade = badgeEl ? badgeEl.textContent?.trim() : 'Not specified';
                        
                        // Examination date requires expanding the accordion; not captured yet.
                        modules.push({ name, moduleCode, credits, grade });
                    }
                }
                return { courseName: headerText, courseCode, modules };
            });

            logger.info(`[SENSOR-LADOK] Parsed ${courseData.courseCode} with ${courseData.modules.length} modules`);

            if (courseData.courseCode !== 'UNKNOWN') {
                // Upsert Course
                const insertedCourse = await db.insert(courses).values({
                    userId: dbUser.id,
                    courseCode: courseData.courseCode,
                    name: courseData.courseName,
                    isCompleted: false
                }).onConflictDoUpdate({
                    target: courses.courseCode,
                    set: { name: courseData.courseName }
                }).returning();
                
                const courseId = insertedCourse[0].id;
                
                // Upsert Modules
                await db.delete(courseModules).where(eq(courseModules.courseId, courseId));
                if (courseData.modules.length > 0) {
                    await db.insert(courseModules).values(
                        courseData.modules.map(m => ({
                            courseId,
                            moduleCode: m.moduleCode,
                            name: m.name,
                            credits: m.credits,
                            grade: m.grade,
                            examinationDate: null
                        }))
                    );
                }
            }
        }
        
        await browser.close();
        logger.info('[SENSOR-LADOK] Real Playwright sync completed successfully.');
        return true;
        
    } catch (error) {
        logger.error({ err: error }, '[SENSOR-LADOK] Playwright error');
        try {
            await page.screenshot({ path: '/home/Samuel/Projects/life_planer/backend/ladok-error.png', fullPage: true });
            logger.info('[SENSOR-LADOK] Error screenshot saved to ladok-error.png');
        } catch (e) {
            logger.error({ err: e }, '[SENSOR-LADOK] Failed to take error screenshot');
        }
        await browser.close();
        return false;
    }
}

/**
 * Scrape available exams from Ladok's Examinations page.
 * Expands each card to extract details and filters for "Annan ort" only.
 */
export async function scrapeLadokExams(username?: string, password?: string): Promise<boolean> {
    logger.info('[SENSOR-LADOK] Starting exam scrape...');

    if (!username || !password) {
        logger.warn('[SENSOR-LADOK] No credentials provided for exam scrape.');
        return false;
    }

    const { browser, page } = await authenticate(username, password);

    try {
        const userList = await db.select().from(users);
        const dbUser = userList[0];
        const allExams: any[] = [];

        // Scrape both tabs
        const tabs = [
            { url: 'https://student.ladok.se/student/app/studentwebb/examinationstillfallen/inte-anmald', status: 'not_signed_up' },
            { url: 'https://student.ladok.se/student/app/studentwebb/examinationstillfallen/anmald', status: 'signed_up' },
        ];

        for (const tab of tabs) {
            logger.info(`[SENSOR-LADOK] Scraping exams: ${tab.status}...`);
            await page.goto(tab.url);
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(2000);

            const cardCount = await page.locator('ladok-examinationstillfalle-kort').count();
            logger.info(`[SENSOR-LADOK] Found ${cardCount} exam cards on ${tab.status} tab.`);

            if (cardCount === 0) {
                const html = await page.content();
                fs.writeFileSync(`/home/Samuel/Projects/life_planer/backend/exams-debug-${tab.status}.html`, html);
                logger.info(`[SENSOR-LADOK] Saved HTML to exams-debug-${tab.status}.html`);
            }

            for (let i = 0; i < cardCount; i++) {
                const card = page.locator('ladok-examinationstillfalle-kort').nth(i);

                // Extract basic info from the card header
                const titleEl = card.locator('.ladok-card-body-rubrik').first();
                const title = await titleEl.textContent().then(t => t?.trim() || '').catch(() => '');
                
                const subRubrikEl = card.locator('.ladok-card-body-sub-rubrik').first();
                const examDate = await subRubrikEl.textContent().then(t => t?.trim() || '').catch(() => '');

                // Extract course name from link
                const courseLink = card.locator('a.card-link').first();
                const courseName = await courseLink.textContent().then(t => t?.trim() || '').catch(() => '');

                // Click "Show more" to expand and get details
                const showMoreBtn = card.locator('ladok-visa-mer button, button[name="Show more"], button[name="Visa mer"]').first();
                const hasShowMore = await showMoreBtn.count() > 0;

                let place = '';
                let signUpPeriod = '';
                let examType = '';
                let scope = '';
                let moduleName = '';

                if (hasShowMore) {
                    await showMoreBtn.click();
                    await page.waitForTimeout(500);

                    // Extract expanded details from the card body
                    const cardBody = card.locator('.card-body').first();
                    const bodyText = await cardBody.textContent().then(t => t || '').catch(() => '');
                    
                    logger.info(`[SENSOR-LADOK] Expanded text for card: ${bodyText}`);

                    // Extract Place
                    const placeMatch = bodyText.match(/Place\s*\n?\s*(.+?)(?:\n|Room|$)/i) 
                                    || bodyText.match(/Plats\s*\n?\s*(.+?)(?:\n|Sal|$)/i);
                    place = placeMatch ? placeMatch[1].trim() : '';

                    // Extract Sign up period
                    const periodMatch = bodyText.match(/Sign up period\s*\n?\s*(.+?)(?:\n|Type|$)/i)
                                     || bodyText.match(/Anmälningsperiod\s*\n?\s*(.+?)(?:\n|Typ|$)/i);
                    signUpPeriod = periodMatch ? periodMatch[1].trim() : '';

                    // Extract Type of examination
                    const typeMatch = bodyText.match(/Type of examination\s*\n?\s*(.+?)(?:\n|Link|$)/i)
                                   || bodyText.match(/Examinationstyp\s*\n?\s*(.+?)(?:\n|Länk|$)/i);
                    examType = typeMatch ? typeMatch[1].trim() : '';

                    // Extract Scope
                    const scopeMatch = bodyText.match(/Scope\s*\n?\s*(.+?)(?:\n|Time|$)/i)
                                    || bodyText.match(/Omfattning\s*\n?\s*(.+?)(?:\n|Tid|$)/i);
                    scope = scopeMatch ? scopeMatch[1].trim() : '';

                    // Extract Given within / module
                    const moduleMatch = bodyText.match(/Given within\s*\n?\s*(.+?)(?:\n|Scope|$)/i)
                                     || bodyText.match(/Ges inom\s*\n?\s*(.+?)(?:\n|Omfattning|$)/i);
                    moduleName = moduleMatch ? moduleMatch[1].trim() : '';

                    // Click "Show less" to collapse
                    const showLessBtn = card.locator('ladok-visa-mindre button, button[name="Show less"], button[name="Visa mindre"]').first();
                    if (await showLessBtn.count() > 0) {
                        await showLessBtn.click();
                        await page.waitForTimeout(300);
                    }
                }

                // Extract course code from course name
                const codeMatch = courseName.match(/([A-Z]{2}\d{3}[A-Z])/);
                const courseCode = codeMatch ? codeMatch[1] : '';

                const externalId = `${title}-${examDate}-${place || 'unknown'}`;

                // Parse the raw scraped date into a real timestamp for sorting/filtering.
                // The first ISO-like date (YYYY-MM-DD) in the string is the exam date.
                let examDateTime: Date | null = null;
                const isoMatch = (examDate || '').match(/\d{4}-\d{2}-\d{2}/);
                if (isoMatch) {
                    const parsed = new Date(isoMatch[0]);
                    if (!isNaN(parsed.getTime())) examDateTime = parsed;
                }

                logger.info(`[SENSOR-LADOK] Exam: "${title}" | ${examDate} | Place: ${place} | Status: ${tab.status}`);

                allExams.push({
                    userId: dbUser.id,
                    courseCode,
                    title,
                    examDate,
                    examDateTime,
                    courseName,
                    place,
                    signUpStatus: tab.status,
                    signUpPeriod,
                    examType,
                    scope,
                    moduleName,
                    externalId,
                });
            }
        }

        // Filter for "Annan ort" / Sollefteå relevant exams.
        // We include signed-up exams, explicitly "annan ort" exams, and unsigned exams 
        // that are not part of the known irrelevant modules (e.g., 3000 which is Östersund).
        const relevantExams = allExams.filter(e =>
            e.place.toLowerCase().includes('annan ort') || 
            e.title.toLowerCase().includes('annan ort') ||
            e.signUpStatus === 'signed_up' ||
            (e.signUpStatus === 'not_signed_up' && !e.moduleName.includes('3000'))
        );

        logger.info(`[SENSOR-LADOK] Total exams found: ${allExams.length}, Annan ort relevant: ${relevantExams.length}`);

        // Clear old exams and insert fresh data
        // We no longer delete all exams because we want to detect new ones and preserve externalIds.
        if (relevantExams.length > 0) {
            for (const exam of relevantExams) {
                // If the exam is not signed up, check if we need to notify the user
                if (exam.signUpStatus === 'not_signed_up') {
                    const existing = await db.select().from(exams).where(eq(exams.externalId, exam.externalId));
                    if (existing.length === 0 || existing[0].signUpStatus !== 'not_signed_up') {
                        // Generate a task notification!
                        // Extract deadline safely. Example format: '2026-04-26 - 2026-05-26'
                        let dlDate = new Date();
                        try {
                            const dlStr = exam.signUpPeriod.split('-')[1]?.trim();
                            if (dlStr) dlDate = new Date(dlStr);
                        } catch(e) {}
                        
                        await db.insert(tasks).values({
                            userId: dbUser.id,
                            source: 'ladok_exam',
                            externalId: `ladok_signup_${exam.externalId}`,
                            title: `Sign up for Ladok Exam: ${exam.title}`,
                            description: `Registration is open for: ${exam.courseName} (${exam.moduleName}). Remember to also book the location on miun.se if needed.`,
                            deadline: dlDate,
                            priorityScore: 90, // High priority
                        }).onConflictDoNothing();
                    }
                }

                // Upsert the exam
                await db.insert(exams).values({ 
                    ...exam, 
                    userId: dbUser.id 
                }).onConflictDoUpdate({
                    target: exams.externalId,
                    set: { 
                        signUpStatus: exam.signUpStatus, 
                        signUpPeriod: exam.signUpPeriod,
                        place: exam.place,
                        scrapedAt: new Date(),
                    }
                });
            }
        }

        await browser.close();
        logger.info('[SENSOR-LADOK] Exam scrape completed successfully.');
        return true;

    } catch (error) {
        logger.error({ err: error }, '[SENSOR-LADOK] Exam scrape error');
        try {
            await page.screenshot({ path: '/home/Samuel/Projects/life_planer/backend/ladok-exam-error.png', fullPage: true });
            logger.info('[SENSOR-LADOK] Error screenshot saved to ladok-exam-error.png');
        } catch (e) {
            logger.error({ err: e }, '[SENSOR-LADOK] Failed to take error screenshot');
        }
        await browser.close();
        return false;
    }
}

/**
 * Sign up for a specific exam on Ladok.
 * WARNING: This is a destructive action — it will register the student for the exam.
 */
export async function signUpForLadokExam(examId: string, username?: string, password?: string): Promise<boolean> {
    logger.info(`[SENSOR-LADOK] Starting exam sign-up for exam ID: ${examId}`);

    if (!username || !password) {
        logger.warn('[SENSOR-LADOK] No credentials provided for exam sign-up.');
        return false;
    }

    // Get the exam details from DB
    const examList = await db.select().from(exams).where(eq(exams.id, examId));
    if (examList.length === 0) {
        logger.error(`[SENSOR-LADOK] Exam not found in database: ${examId}`);
        return false;
    }
    const exam = examList[0];
    logger.info(`[SENSOR-LADOK] Signing up for: "${exam.title}" on ${exam.examDate}`);

    const { browser, page } = await authenticate(username, password);

    try {
        // Navigate to "Not signed up" exams
        await page.goto('https://student.ladok.se/student/app/studentwebb/examinationstillfallen/inte-anmald');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // Find the matching exam card
        const cards = page.locator('ladok-examinationstillfalle-kort');
        const cardCount = await cards.count();
        let found = false;

        for (let i = 0; i < cardCount; i++) {
            const card = cards.nth(i);
            const titleEl = card.locator('.ladok-card-body-rubrik').first();
            const cardTitle = await titleEl.textContent().then(t => t?.trim() || '').catch(() => '');

            if (cardTitle.toLowerCase().includes(exam.title.toLowerCase()) || 
                (exam.title.toLowerCase().includes('annan ort') && cardTitle.toLowerCase().includes('annan ort'))) {
                
                // Click "Show more" to expand
                const showMoreBtn = card.locator('ladok-visa-mer button, button[name="Show more"], button[name="Visa mer"]').first();
                if (await showMoreBtn.count() > 0) {
                    await showMoreBtn.click();
                    await page.waitForTimeout(1000);
                }

                // Look for sign-up button inside the expanded card
                const signUpBtn = card.locator('button:has-text("Sign up"), button:has-text("Anmäl")').first();
                if (await signUpBtn.count() > 0) {
                    logger.info('[SENSOR-LADOK] Found sign-up button, clicking...');
                    await signUpBtn.click();
                    await page.waitForTimeout(2000);

                    // Check if a confirmation modal appeared
                    const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Bekräfta"), button[name="Anmal"]:visible').first();
                    if (await confirmBtn.count() > 0) {
                        logger.info('[SENSOR-LADOK] Found confirmation modal, clicking confirm...');
                        await confirmBtn.click();
                        await page.waitForTimeout(3000);
                    } else {
                        // No known confirm selector matched - the Ladok UI may have changed.
                        // Fall back to Vision-AI auto-healing before assuming there is no modal.
                        const healed = await visionHealClick(page, 'the button that confirms/submits the exam registration in the modal dialog');
                        await page.waitForTimeout(healed ? 3000 : 1000);
                    }

                    // Update DB
                    await db.update(exams).set({ signUpStatus: 'signed_up' }).where(eq(exams.id, examId));
                    logger.info('[SENSOR-LADOK] ✅ Successfully signed up for exam!');
                    found = true;
                    break;
                } else {
                    logger.warn('[SENSOR-LADOK] Could not find sign-up button in expanded card.');
                }
            }
        }

        if (!found) {
            logger.error('[SENSOR-LADOK] Could not find matching exam card on the page.');
        }

        await browser.close();
        return found;

    } catch (error) {
        logger.error({ err: error }, '[SENSOR-LADOK] Exam sign-up error');
        try {
            await page.screenshot({ path: '/home/Samuel/Projects/life_planer/backend/ladok-signup-error.png', fullPage: true });
        } catch (e) { /* ignore */ }
        await browser.close();
        return false;
    }
}
