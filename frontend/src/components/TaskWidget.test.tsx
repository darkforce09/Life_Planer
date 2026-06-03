import React from 'react';
import { render } from '@testing-library/react-native';
import { TaskWidget } from './TaskWidget';

// Mock the SQLite database wrapper
jest.mock('../db/database', () => ({
  getDatabase: jest.fn().mockResolvedValue({
    getAllAsync: jest.fn().mockResolvedValue([
      { id: '1', title: 'Test Mock Task', priorityScore: 50 }
    ])
  }),
  syncTasksFromServer: jest.fn().mockResolvedValue(true)
}));

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
