/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { Button } from './button';
import { Anthropicon, type AnthropiconName } from '../icons';
import { useEffect, useRef } from 'react';

export interface ConsoleMessage {
  id: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
  timestamp: Date;
  source?: string;
}

interface ConsoleProps {
  messages: ConsoleMessage[];
  onClose: () => void;
  className?: string;
  maxHeight?: number;
}

const levelConfig = {
  log: {
    text: 'text-on-overlay',
    bg: 'bg-transparent',
    icon: 'info' as AnthropiconName,
    iconColor: 'text-on-overlay',
    prefix: '',
  },
  info: {
    text: 'text-on-overlay',
    bg: 'bg-transparent',
    icon: 'info' as AnthropiconName,
    iconColor: 'text-on-overlay',
    prefix: '',
  },
  warn: {
    text: 'text-warning',
    bg: 'bg-warning-fill/10',
    icon: 'warning' as AnthropiconName,
    iconColor: 'text-warning',
    prefix: 'Warning:',
  },
  error: {
    text: 'text-danger',
    bg: 'bg-danger-fill/10',
    icon: 'x' as AnthropiconName,
    iconColor: 'text-danger',
    prefix: 'Error:',
  },
};

export default function Console({
  messages,
  onClose,
  className = '',
  maxHeight = 300,
}: ConsoleProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 显示所有消息
  const filteredMessages = messages;

  const renderMessage = (msg: ConsoleMessage) => {
    const config = levelConfig[msg.level];
    const iconName = config.icon;
    const showIcon = msg.level === 'error' || msg.level === 'warn';

    return (
      <div key={msg.id} className={`px-3 py-1 text-sm ${config.bg} rounded font-mono font-normal`}>
        <div className="flex items-center gap-2">
          {showIcon && <Anthropicon name={iconName} size={16} className={config.iconColor} />}
          <div className="flex-1 min-w-0">
            <div
              className={`${config.text} whitespace-pre-wrap break-words leading-relaxed font-medium`}
            >
              {config.prefix && <span>{config.prefix} </span>}
              {msg.message}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`bg-[var(--console-surface)] text-on-overlay relative flex flex-col ${className}`}
      style={{ height: maxHeight }}
    >
      {/* Floating Header */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between">
        <div className="border border-hairline rounded-md px-2 py-1 text-xs text-on-overlay/80 flex items-center gap-1.5">
          <Anthropicon name="code" size={16} />
          Console Messages
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="p-0 text-on-overlay/80 hover:text-on-overlay hover:bg-white/10"
        >
          <Anthropicon name="x" size={16} />
        </Button>
      </div>

      {/* Messages */}
      <div ref={consoleRef} className="flex-1 overflow-y-auto pt-16 px-3 pb-3">
        {filteredMessages.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-on-overlay text-sm font-medium">
            No console output
          </div>
        ) : (
          <div className="space-y-1">
            {filteredMessages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
