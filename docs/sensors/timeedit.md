# TimeEdit Integration

## Goal
To automatically sync the official university schedule (lectures, seminars, exams) into the Brain, giving context to assignments.

## Data Required
- **Events:** Title, start time, end time, location, course code.

## API / Access Strategy
- **Subscription Link Provided:** 
  `https://cloud.timeedit.net/miun/web/student/ri62l1vQ7140Y3QQZ1Zw1d795o5tZ21Z5y6YQYQ6n2560X10k6800Z51555Et7FB087010C65o227BCQ6410EDB0449moD9F93B6.ics`
- We will fetch and parse this `.ics` file to extract events. No active authentication is required since the hash in the URL acts as the auth token.

## Polling Frequency
- Once daily, or triggered manually if schedule changes are expected.

## Implementation & Engineering Notes
- **Programming Method:** Must be implemented as an OOP Class (`TimeEditService`) responsible for fetching and parsing `.ics` files.
- **Code Documentation:** Use JSDoc to explicitly document the parsing logic, especially how raw iCal strings are mapped to the normalized `Event` data structure.
