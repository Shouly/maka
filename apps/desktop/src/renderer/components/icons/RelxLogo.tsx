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

/**
 * RELX Y 字标 **
 */

import { useId } from 'react';

export function RelxLogo({ className }: { className?: string }) {
  const cid = useId();
  const mid = useId();
  return (
    <svg
      viewBox="0 0 109 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="RELX Y"
      className={className}
    >
      <g clipPath={`url(#${cid})`}>
        <mask
          id={mid}
          style={{ maskType: 'luminance' }}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="81"
          height="16"
        >
          <path d="M81 0H0V16H81V0Z" fill="white" />
        </mask>
        <g mask={`url(#${mid})`}>
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M39.3217 0H23.7751C22.6622 0 21.7602 0.895507 21.7602 1.99997V3.83145C21.7602 3.92441 21.8361 3.99993 21.9297 3.99993H37.4765C38.5893 3.99993 39.4914 3.10443 39.4914 1.99997V0.168477C39.4914 0.0755187 39.4155 0 39.3217 0Z"
            fill="currentColor"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M22.334 9.99993H37.711C37.8047 9.99993 37.8806 9.9244 37.8806 9.83147V6.16848C37.8806 6.07552 37.8047 6 37.711 6H22.334C22.2402 6 22.1642 6.07552 22.1642 6.16848V9.83147C22.1642 9.9244 22.2402 9.99993 22.334 9.99993Z"
            fill="currentColor"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M37.4765 12H21.9299C21.8361 12 21.7602 12.0755 21.7602 12.1685V13.9999C21.7602 15.1044 22.6624 15.9999 23.7751 15.9999H39.3217C39.4155 15.9999 39.4914 15.9244 39.4914 15.8315V13.9999C39.4914 12.8955 38.5892 12 37.4765 12Z"
            fill="currentColor"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M13.877 9.9998H14.6933H15.9177C17.0449 9.9998 17.9584 9.10433 17.9584 7.99987V1.99997C17.9584 0.895507 17.0449 0 15.9177 0H0.171912C0.0768947 0 0 0.0755187 0 0.168477V1.99997C0 3.10443 0.913761 3.99993 2.04073 3.99993H13.877V5.9999H4.08147H2.04073C0.913761 5.9999 0 6.8954 0 7.99987V15.8313C0 15.9242 0.0768947 15.9997 0.171912 15.9997H2.04073C3.16787 15.9997 4.08147 15.1042 4.08147 13.9997V9.9998H7.28872L12.8131 15.414C13.1958 15.789 13.7149 15.9997 14.2561 15.9997H18.768C18.9211 15.9997 18.9977 15.8183 18.8895 15.7122L13.0607 9.9998H13.877Z"
            fill="currentColor"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M58.2628 11.9998H47.9549V1.99997C47.9549 0.895507 47.0527 0 45.94 0H44.0946C44.001 0 43.9251 0.0755187 43.9251 0.168477V13.9997C43.9251 15.1042 44.8272 15.9997 45.94 15.9997H47.149H47.9549H56.4176C57.5302 15.9997 58.4325 15.1042 58.4325 13.9997V12.1683C58.4325 12.0753 58.3565 11.9998 58.2628 11.9998Z"
            fill="currentColor"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M80.8299 0H76.5382C75.8963 0 75.2807 0.252795 74.8271 0.703027L70.3208 5.17143L65.8151 0.703027C65.3612 0.252795 64.7455 0 64.1037 0H59.812C59.6608 0 59.585 0.181437 59.692 0.287515L67.469 7.99987L59.692 15.7122C59.585 15.8183 59.6608 15.9997 59.812 15.9997H64.1037C64.7455 15.9997 65.3612 15.7469 65.8151 15.2967L70.3208 10.8283L74.8271 15.2967C75.2807 15.7469 75.8963 15.9997 76.5382 15.9997H80.8299C80.9811 15.9997 81.0567 15.8183 80.9501 15.7122L73.1727 7.99987L80.9501 0.287515C81.0567 0.181437 80.9811 0 80.8299 0Z"
            fill="currentColor"
          />
        </g>
        <path
          d="M89.23 0.2793 A0.17 0.17 0 0 1 89.36 0 L93.88 0 A0.9 0.9 0 0 1 94.57 0.3215 L99 5.601 L103.4 0.3215 A0.9 0.9 0 0 1 104.1 0 L108.6 0 A0.17 0.17 0 0 1 108.8 0.2793 L101 9.534 L101 15.83 A0.17 0.17 0 0 1 100.8 16 L97.17 16 A0.17 0.17 0 0 1 97 15.83 L97 9.534 Z"
          fill="currentColor"
        />
      </g>
      <defs>
        <clipPath id={cid}>
          <rect width="109" height="16" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
