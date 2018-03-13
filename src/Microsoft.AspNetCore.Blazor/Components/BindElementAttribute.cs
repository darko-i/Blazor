// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.

using System;

namespace Microsoft.AspNetCore.Blazor.Components
{
    [AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
    public sealed class BindElementAttribute : Attribute
    {
        public BindElementAttribute(string element, string valueAttribute, string changeHandlerAttribute)
        {
            if (element == null)
            {
                throw new ArgumentNullException(nameof(element));
            }

            if (valueAttribute == null)
            {
                throw new ArgumentNullException(nameof(valueAttribute));
            }

            if (changeHandlerAttribute == null)
            {
                throw new ArgumentNullException(nameof(changeHandlerAttribute));
            }

            Element = element;
            ValueAttribute = valueAttribute;
            ChangeHandlerAttribute = changeHandlerAttribute;
        }

        public string Element { get; }

        public string ValueAttribute { get; }

        public string ChangeHandlerAttribute { get; }
    }
}
