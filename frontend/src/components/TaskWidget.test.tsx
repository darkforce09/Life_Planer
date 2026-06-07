import React from 'react';
import { render } from '@testing-library/react-native';
import { TaskWidget } from './TaskWidget';

// Mock the SQLite database wrapper. syncTasksFromServer must resolve to an
// array of tasks (the component sets that directly into state).
jest.mock('../db/database', () => {
  const tasks = [{ id: '1', title: 'Test Mock Task', priorityScore: 50 }];
  return {
    getDatabase: jest.fn().mockResolvedValue({
      getAllAsync: jest.fn().mockResolvedValue(tasks),
    }),
    syncTasksFromServer: jest.fn().mockResolvedValue(tasks),
  };
});

describe('TaskWidget Component', () => {
  it('renders correctly and shows offline SQLite tasks', async () => {
    const { findByText } = render(<TaskWidget />);
    
    // Check if the offline mock task is rendered
    const taskTitle = await findByText('Test Mock Task');
    expect(taskTitle).toBeTruthy();
    
    // Check if the priority score is rendered
    const priorityScore = await findByText('Priority Score: 50');
    expect(priorityScore).toBeTruthy();
  });
});
